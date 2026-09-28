export interface Message {
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
}

export interface ToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}