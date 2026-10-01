import { ref } from 'vue'
import { z } from 'zod'
import { getProductInfo, getPrice, getProcessInfo } from '../services/factory'
import type { Message, ToolResult } from '../types'

interface ToolTimelineItem {
  name: string   // 工具名
  args: string   // 参数
  result: string // 结果
  time: string   // 调用时间
}

const REQUEST_TIMEOUT_MS = 30_000

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  onTimeout: () => void
): Promise<Response> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      onTimeout()
      reject(new Error('请求超时，请稍后重试'))
    }, REQUEST_TIMEOUT_MS)
  })

  try {
    // 请求和超时竞争，先完成的一方决定结果。
    return await Promise.race([fetch(input, init), timeoutPromise])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

// localStorage 是外部可修改的数据，先校验再恢复为聊天消息。
const storedMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'tool', 'system']),
  content: z.string().nullable().optional(),
  reasoning_content: z.string().optional(),
  tool_calls: z.array(z.object({
    id: z.string(),
    type: z.literal('function'),
    function: z.object({
      name: z.string(),
      arguments: z.string()
    })
  })).optional(),
  tool_call_id: z.string().optional()
})

// 产品信息和报价工具必须收到非空的产品名称。
const toolArgumentsSchema = z.object({
  productName: z.string().trim().min(1)
})

// 流程工具没有参数，并拒绝模型额外传入未知字段。
const emptyToolArgumentsSchema = z.object({}).strict()
const reasoning = ref('')

function loadChatHistory(): Message[] {
  try {
    const storedHistory = JSON.parse(localStorage.getItem('chatHistory') || '[]')
    const result = z.array(storedMessageSchema).safeParse(storedHistory)
    // 历史记录损坏时从空会话开始，避免阻塞整个页面初始化。
    return result.success ? result.data as Message[] : []
  } catch {
    return []
  }
}

async function readSseStream(response: Response, onData: (data: string) => void) {
  if (!response.body) throw new Error('响应内容为空')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let dataLines: string[] = []

  // SSE 事件以空行结束；先缓存不完整行，避免网络分块截断 JSON。
  const dispatchEvent = () => {
    if (dataLines.length) onData(dataLines.join('\n'))
    dataLines = []
  }

  const processLine = (line: string) => {
    if (!line) {
      dispatchEvent()
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).replace(/^ /, ''))
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    // stream 模式会保留跨字节块的 UTF-8 字符，直到字符完整再解码。
    buffer += decoder.decode(value, { stream: !done })

    let newlineIndex = buffer.indexOf('\n')
    while (newlineIndex !== -1) {
      processLine(buffer.slice(0, newlineIndex).replace(/\r$/, ''))
      buffer = buffer.slice(newlineIndex + 1)
      newlineIndex = buffer.indexOf('\n')
    }

    if (done) break
  }

  if (buffer) processLine(buffer.replace(/\r$/, ''))
  dispatchEvent()
}

function assertResponseOk(response: Response) {
  // 首次请求和工具回传共用状态检查，避免把 HTTP 错误当成空回复。
  if (response.ok) return
  if (response.status === 401) throw new Error('API Key 无效，请检查配置')
  if (response.status === 429) throw new Error('请求太频繁，请稍后再试')
  if (response.status >= 500) throw new Error('服务器异常，请稍后重试')
  throw new Error(`请求失败：${response.status}`)
}


export function useAgent() {
  const timeline = ref<ToolTimelineItem[]>([])
  const totalTokens = ref(0)
  type AgentStatus = 'idle' | 'thinking' | 'tool_calling' | 'answering' | 'done'
  let rafId: number | null = null
  function scheduleUpdate(callback: () => void) {
    if (rafId !== null) return // 已经排了，不重复排
    rafId = requestAnimationFrame(() => {
      rafId = null
      callback()
    })
  }
  const messages = ref<Message[]>(loadChatHistory())
  const output = ref('')
  const loading = ref(false)
  const toolStatus = ref('')
  const showToolPanel = ref(false)
  const agentStatus = ref<AgentStatus>('idle')

  let controller: AbortController | null = null
  let thinkingTimer: ReturnType<typeof setInterval> | null = null

  function clearThinkingTimer() {
    // 无论收到内容、取消还是失败，都停止“思考中”占位动画。
    if (thinkingTimer) {
      clearInterval(thinkingTimer)
      thinkingTimer = null
    }
  }

  async function send(userText: string) {
    if (!userText.trim() || loading.value) return
    // 1. 用户发送后，进入 thinking
    agentStatus.value = 'thinking'
    reasoning.value = ''

    messages.value.push({ role: 'user', content: userText })
    localStorage.setItem('chatHistory', JSON.stringify(messages.value))

    output.value = '思考中'
    loading.value = true
    thinkingTimer = setInterval(() => {
      output.value += '.'
    }, 300)

    // 同一个信号控制首轮请求和工具执行后的 follow-up 请求。
    const requestController = new AbortController()
    controller = requestController
    // 错误和取消提示要留在界面；成功回复已写入 messages，可清空临时输出。
    let preserveOutput = false

    try {
      const response = await fetchWithTimeout('/api/chat', {
        signal: requestController.signal,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'deepseek-flash',
          messages: [
            {
              role: 'system',
              content: '你是机械零件产品顾问，回答机械零件、适配信息、定制流程和报价相关问题。产品参数和价格以工具返回内容为准；缺少设备用途、图纸或样件时，明确说明需要补充信息，不要编造规格、材质、精度或价格。请始终使用中文进行思考和回答'
            },
            ...messages.value
          ],
          tools: [
            {
              type: 'function',
              function: {
                name: 'getProductInfo',
                description: '获取指定产品的用途、参数和材质信息',
                parameters: {
                  type: 'object',
                  properties: {
                    productName: { type: 'string', description: '机械零件名称，如传动轴及轴套、轴承座、支架及连接件' }
                  },
                  required: ['productName']
                }
              }
            },
            {
              type: 'function',
              function: {
                name: 'getPrice',
                description: '获取指定产品的参考价格',
                parameters: {
                  type: 'object',
                  properties: {
                    productName: { type: 'string', description: '产品名称' }
                  },
                  required: ['productName']
                }
              }
            },
            {
              type: 'function',
              function: {
                name: 'getProcessInfo',
                description: '获取加工流程信息，如打样、报价、交付流程',
                parameters: {
                  type: 'object',
                  properties: {}
                }
              }
            }
          ],
          stream: true,
          stream_options: { include_usage: true }
        })
      }, () => requestController.abort())

      assertResponseOk(response)

      let fullReply = ''
      let reasoningContent = ''
      let firstRequestTokens = 0
      let isFirstContent = true
      const toolCallsMap = new Map<string, { name: string; args: string }>()
      let lastToolCallId = ''

      await readSseStream(response, (dataStr) => {
        if (dataStr === '[DONE]') return
        const json = JSON.parse(dataStr)
        if (json.error) throw new Error(json.error.message || '模型请求失败')
        const reportedTokens = json.usage?.total_tokens
        if (typeof reportedTokens === 'number' && reportedTokens >= firstRequestTokens) {
          totalTokens.value += reportedTokens - firstRequestTokens
          firstRequestTokens = reportedTokens
        }
        const delta = json.choices?.[0]?.delta
        if (delta?.reasoning_content) reasoningContent += delta.reasoning_content
        if (delta?.reasoning_content) reasoning.value += delta.reasoning_content
        if (delta?.tool_calls) {
          // 2. 收到 tool_calls 时，进入 tool_calling
          agentStatus.value = 'tool_calling'
          for (const toolCall of delta.tool_calls) {
            const id = toolCall.id || lastToolCallId
            if (!id) continue
            lastToolCallId = id

            if (!toolCallsMap.has(id)) {
              toolCallsMap.set(id, { name: '', args: '' })
            }
            const entry = toolCallsMap.get(id)!
            if (toolCall.function?.name) entry.name = toolCall.function.name
            if (toolCall.function?.arguments) entry.args += toolCall.function.arguments

            clearThinkingTimer()
            output.value = ''
            showToolPanel.value = true
            toolStatus.value = `正在调用工具：${entry.name || '...'}\n参数收集：${entry.args}`
          }
        }

        const content = delta?.content || ''
        if (content) {
          // 3. 收到普通文本时，进入 answering
          agentStatus.value = 'answering'
          if (isFirstContent) {
            clearThinkingTimer()
            output.value = ''
            isFirstContent = false
          }
          scheduleUpdate(() => {
            output.value += content
          })
          fullReply += content
        }
      })

      // 工具执行 + 回传
      if (toolCallsMap.size > 0) {
        for (const [id, entry] of toolCallsMap.entries()) {
          console.log(`工具 ${entry.name} 参数：`, entry.args)

          let args: Record<string, string>
          try {
            const parsedArgs: unknown = JSON.parse(entry.args)
            // 不同工具的参数契约不同，流程工具使用空对象 schema。
            const schema = entry.name === 'getProcessInfo'
              ? emptyToolArgumentsSchema
              : toolArgumentsSchema
            const result = schema.safeParse(parsedArgs)
            if (!result.success) throw new Error(result.error.issues[0]?.message || '缺少 productName')
            args = result.data
          } catch (error) {
            console.error('工具参数校验失败：', error)
            toolStatus.value = `❌ 工具参数校验失败：${entry.args}`
            continue
          }

          let result = ''
          if (entry.name === 'getProductInfo') {
            result = getProductInfo(args.productName)
          } else if (entry.name === 'getPrice') {
            result = getPrice(args.productName)
          } else if (entry.name === 'getProcessInfo') {
            result = getProcessInfo()
          } else {
            result = '未识别的工具调用'
          }

          toolStatus.value = `✅ 工具调用完成\n工具名：${entry.name}\n参数：${JSON.stringify(args)}\n结果：${result}`
          output.value += `\n[工具调用] ${entry.name}：${result}\n`

          messages.value.push({
            role: 'assistant',
            content: null,
            ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
            tool_calls: [{
              id,
              type: 'function',
              function: { name: entry.name, arguments: entry.args }
            }]
          })
          const toolResult: ToolResult = {
            tool_call_id: id,
            content: result
          }
          messages.value.push({ role: 'tool', ...toolResult })
          timeline.value.push({
            name: entry.name,
            args: JSON.stringify(args),
            result,
            time: new Date().toLocaleTimeString()
          })
        }

        // 工具结果需要再请求模型组织答案，继续沿用首轮的取消信号。
        await followUp(requestController.signal)
      } else if (fullReply) {
        messages.value.push({ role: 'assistant', content: fullReply })
        agentStatus.value = 'done'
      }

      localStorage.setItem('chatHistory', JSON.stringify(messages.value))
    } catch (error: any) {
      agentStatus.value = 'idle'
      if (error.name === 'AbortError') {
        output.value = '已停止生成'
        preserveOutput = true
      } else if (error.message.includes('Failed to fetch')) {
        output.value = '❌ 网络异常，请检查网络连接'
        preserveOutput = true
      } else if (error.name === 'SyntaxError') {
        output.value = '❌ 响应格式异常，请重试'
        preserveOutput = true
      } else {
        output.value = '❌ ' + error.message
        preserveOutput = true
      }
    } finally {
      clearThinkingTimer()
      loading.value = false
      if (!preserveOutput) output.value = ''
      if (controller === requestController) controller = null
    }
  }

  async function followUp(signal: AbortSignal) {
    const response = await fetchWithTimeout('/api/chat', {
      signal,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'deepseek-flash',
        messages: [
          {
            role: 'system',
            content: '你是机械零件产品顾问，回答机械零件、适配信息、定制流程和报价相关问题。产品参数和价格以工具返回内容为准；缺少设备用途、图纸或样件时，明确说明需要补充信息，不要编造规格、材质、精度或价格。请始终使用中文进行思考和回答'
          },
          ...messages.value
        ],
        stream: true,
        stream_options: { include_usage: true }
      })
    }, () => {
      if (!signal.aborted) controller?.abort()
    })

    assertResponseOk(response)

    let fullReply = ''
    let followUpTokens = 0

    await readSseStream(response, (dataStr) => {
      if (dataStr === '[DONE]') return
      const json = JSON.parse(dataStr)
      if (json.error) throw new Error(json.error.message || '模型请求失败')
      const reportedTokens = json.usage?.total_tokens
      if (typeof reportedTokens === 'number' && reportedTokens >= followUpTokens) {
        totalTokens.value += reportedTokens - followUpTokens
        followUpTokens = reportedTokens
      }
      const content = json.choices?.[0]?.delta?.content || ''
      if (content) {
        scheduleUpdate(() => {
          output.value += content
        })
        fullReply += content
      }
    })

    messages.value.push({ role: 'assistant', content: fullReply })
    localStorage.setItem('chatHistory', JSON.stringify(messages.value))
    // 4. followUp 完整收到最终回复后，才进入 done。
    agentStatus.value = 'done'
  }

  function stop() {
    if (controller && !controller.signal.aborted) {
      controller.abort()
      clearThinkingTimer()
      agentStatus.value = 'idle'
    }
  }

  function clearHistory() {
    messages.value = []
    localStorage.removeItem('chatHistory')
    output.value = ''
    reasoning.value = ''
    showToolPanel.value = false
    toolStatus.value = ''
    agentStatus.value = 'idle'
  }

  return {
    messages,
    output,
    loading,
    toolStatus,
    showToolPanel,
    agentStatus,
    send,
    stop,
    clearHistory,
    reasoning,
    timeline,
    totalTokens,
  }
}