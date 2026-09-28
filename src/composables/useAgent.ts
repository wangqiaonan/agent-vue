import { ref } from 'vue'
import { getProductInfo, getPrice, getProcessInfo } from '../services/factory'
import type { Message } from '../types'

export function useAgent() {
  const messages = ref<Message[]>(JSON.parse(localStorage.getItem('chatHistory') || '[]'))
  const output = ref('')
  const loading = ref(false)
  const toolStatus = ref('')
  const showToolPanel = ref(false)

  let controller: AbortController | null = null
  let thinkingTimer: ReturnType<typeof setInterval> | null = null

  async function send(userText: string) {
    if (!userText.trim()) return

    messages.value.push({ role: 'user', content: userText })
    localStorage.setItem('chatHistory', JSON.stringify(messages.value))

    output.value = '思考中'
    loading.value = true
    thinkingTimer = setInterval(() => {
      output.value += '.'
    }, 300)

    controller = new AbortController()

    try {
      const response = await fetch('https://api.deepseek.com/chat/completions', {
        signal: controller.signal,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer <YOUR_API_KEY>'
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

      if (!response.ok) {
        const status = response.status
        if (status === 401) throw new Error('API Key 无效，请检查配置')
        if (status === 429) throw new Error('请求太频繁，请稍后再试')
        if (status >= 500) throw new Error('服务器异常，请稍后重试')
        throw new Error(`请求失败：${status}`)
      }

      const reader = response.body!.getReader()
      const decoder = new TextDecoder()

      let fullReply = ''
      let isFirstContent = true
      const toolCallsMap = new Map<string, { name: string; args: string }>()
      let lastToolCallId = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const text = decoder.decode(value)

        const lines = text.split('\n').filter(line => line.trim() !== '')
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.replace('data: ', '')
            if (dataStr === '[DONE]') continue
            try {
              const json = JSON.parse(dataStr)
              const delta = json.choices?.[0]?.delta

              // 工具调用：按 id 收集，避免重复拼接
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

                  if (thinkingTimer) {
                    clearInterval(thinkingTimer)
                    thinkingTimer = null
                    output.value = ''
                  }

                  showToolPanel.value = true
                  toolStatus.value = `正在调用工具：${entry.name || '...'}\n参数收集：${entry.args}`
                }
              }

              const content = delta?.content || ''
              if (content) {
                if (isFirstContent) {
                  if (thinkingTimer) {
                    clearInterval(thinkingTimer)
                    thinkingTimer = null
                  }
                  output.value = ''
                  isFirstContent = false
                }
                output.value += content
                fullReply += content
              }
            } catch (e) {}
          }
        }
      }

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
            tool_calls: [{
              id,
              type: 'function',
              function: { name: entry.name, arguments: entry.args }
            }]
          })
          messages.value.push({
            role: 'tool',
            tool_call_id: id,
            content: result
          })
        }

        await followUp()
      } else if (fullReply) {
        messages.value.push({ role: 'assistant', content: fullReply })
      }

      localStorage.setItem('chatHistory', JSON.stringify(messages.value))
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.log('用户手动停止了生成')
      } else if (error.message.includes('Failed to fetch')) {
        output.value = '❌ 网络异常，请检查网络连接'
      } else if (error.name === 'SyntaxError') {
        output.value = '❌ 响应格式异常，请重试'
      } else {
        output.value = '❌ ' + error.message
      }
    } finally {
      loading.value = false
      output.value = ''
    }
  }

  async function followUp() {
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer <YOUR_API_KEY>'
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

    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let fullReply = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const text = decoder.decode(value)
      const lines = text.split('\n').filter(l => l.trim() !== '')
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const dataStr = line.replace('data: ', '')
          if (dataStr === '[DONE]') continue
          try {
            const json = JSON.parse(dataStr)
            const content = json.choices?.[0]?.delta?.content || ''
            if (content) {
              output.value += content
              fullReply += content
            }
          } catch (e) {}
        }
      }
    }

    messages.value.push({ role: 'assistant', content: fullReply })
    localStorage.setItem('chatHistory', JSON.stringify(messages.value))
  }

  function stop() {
    if (controller) {
      controller.abort()
      if (thinkingTimer) {
        clearInterval(thinkingTimer)
        thinkingTimer = null
      }
      output.value += '\n\n[已停止生成]'
      controller = null
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