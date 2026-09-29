import { ref } from 'vue'
import { getProductInfo, getPrice, getProcessInfo } from '../services/factory'
import type { Message, ToolResult } from '../types'

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
  let rafId: number | null = null
  function scheduleUpdate(callback: () => void) {
    if (rafId !== null) return // 已经排了，不重复排
    rafId = requestAnimationFrame(() => {
      rafId = null
      callback()
    })
  }
  const messages = ref<Message[]>(JSON.parse(localStorage.getItem('chatHistory') || '[]'))
  const output = ref('')
  const loading = ref(false)
  const toolStatus = ref('')
  const showToolPanel = ref(false)

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
      const response = await fetch('https://api.deepseek.com/chat/completions', {
        signal: requestController.signal,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer sk-99f281866a864050ba01aed8977d58cc'
        },
        body: JSON.stringify({
          model: 'deepseek-flash',
          messages: [
            {
              role: 'system',
              content: '你是机械零件产品顾问，回答机械零件、适配信息、定制流程和报价相关问题。产品参数和价格以工具返回内容为准；缺少设备用途、图纸或样件时，明确说明需要补充信息，不要编造规格、材质、精度或价格。'
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
          stream: true
        })
      })

      assertResponseOk(response)

      let fullReply = ''
      let reasoningContent = ''
      let isFirstContent = true
      const toolCallsMap = new Map<string, { name: string; args: string }>()
      let lastToolCallId = ''

      await readSseStream(response, (dataStr) => {
        if (dataStr === '[DONE]') return
        const json = JSON.parse(dataStr)
        if (json.error) throw new Error(json.error.message || '模型请求失败')
        const delta = json.choices?.[0]?.delta
        if (delta?.reasoning_content) reasoningContent += delta.reasoning_content

        if (delta?.tool_calls) {
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

          let args: any = {}
          try {
            args = JSON.parse(entry.args)
          } catch (e) {
            try {
              args = JSON.parse(entry.args + '}')
            } catch (e2) {
              console.error('工具参数解析失败：', entry.args)
              toolStatus.value = `❌ 工具参数解析失败：${entry.args}`
              continue
            }
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
        }

        // 工具结果需要再请求模型组织答案，继续沿用首轮的取消信号。
        await followUp(requestController.signal)
      } else if (fullReply) {
        messages.value.push({ role: 'assistant', content: fullReply })
      }

      localStorage.setItem('chatHistory', JSON.stringify(messages.value))
    } catch (error: any) {
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
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      signal,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer sk-99f281866a864050ba01aed8977d58cc'
      },
      body: JSON.stringify({
        model: 'deepseek-flash',
        messages: [
          {
            role: 'system',
            content: '你是机械零件产品顾问，回答机械零件、适配信息、定制流程和报价相关问题。产品参数和价格以工具返回内容为准；缺少设备用途、图纸或样件时，明确说明需要补充信息，不要编造规格、材质、精度或价格。'
          },
          ...messages.value
        ],
        stream: true
      })
    })

    assertResponseOk(response)

    let fullReply = ''

    await readSseStream(response, (dataStr) => {
      if (dataStr === '[DONE]') return
      const json = JSON.parse(dataStr)
      if (json.error) throw new Error(json.error.message || '模型请求失败')
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
  }

  function stop() {
    if (controller && !controller.signal.aborted) {
      controller.abort()
      clearThinkingTimer()
    }
  }

  function clearHistory() {
    messages.value = []
    localStorage.removeItem('chatHistory')
    output.value = ''
    showToolPanel.value = false
    toolStatus.value = ''
  }

  return {
    messages,
    output,
    loading,
    toolStatus,
    showToolPanel,
    send,
    stop,
    clearHistory
  }
}