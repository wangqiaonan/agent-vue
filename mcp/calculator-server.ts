import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const server = new McpServer({
  name: 'calculator-server',
  version: '1.0.0'
})

// 注册工具：加法
server.tool(
  'add',
  '计算两个数字的和',
  {
    a: z.number().describe('第一个数字'),
    b: z.number().describe('第二个数字')
  },
  async ({ a, b }) => {
    return {
      content: [{ type: 'text', text: String(a + b) }]
    }
  }
)

// 注册工具：减法
server.tool(
  'subtract',
  '计算两个数字的差',
  {
    a: z.number().describe('被减数'),
    b: z.number().describe('减数')
  },
  async ({ a, b }) => {
    return {
      content: [{ type: 'text', text: String(a - b) }]
    }
  }
)

// 注册工具：乘法
server.tool(
  'multiply',
  '计算两个数字的积',
  {
    a: z.number().describe('第一个数字'),
    b: z.number().describe('第二个数字')
  },
  async ({ a, b }) => {
    return {
      content: [{ type: 'text', text: String(a * b) }]
    }
  }
)

// 注册工具：除法
server.tool(
  'divide',
  '计算两个数字的商',
  {
    a: z.number().describe('被除数'),
    b: z.number().describe('除数')
  },
  async ({ a, b }) => {
    if (b === 0) {
      return {
        content: [{ type: 'text', text: '错误：除数不能为 0' }],
        isError: true
      }
    }
    return {
      content: [{ type: 'text', text: String(a / b) }]
    }
  }
)

// 用 stdio 启动
const transport = new StdioServerTransport()
await server.connect(transport)