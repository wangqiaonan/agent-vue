export interface ToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export interface UserMessage {
  role: 'user'
  content: string
}

export interface AssistantMessage {
  role: 'assistant'
  content: string | null
  reasoning_content?: string
  tool_calls?: ToolCall[]
}

export interface ToolMessage {
  role: 'tool'
  tool_call_id: string
  content: string
}

export interface SystemMessage {
  role: 'system'
  content: string
}

export type Message = UserMessage | AssistantMessage | ToolMessage | SystemMessage

export interface ToolResult {
  tool_call_id: string
  content: string
}