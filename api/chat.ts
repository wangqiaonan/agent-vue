// api/chat.ts
export const config = {
  runtime: 'edge'  // 用 Edge Runtime，支持流式响应
}

export default async function handler(req: Request) {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  const body = await req.text()

  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.VITE_DEEPSEEK_API_KEY}`
    },
    body
  })

  // 非 200 直接返回错误，让前端走错误分类处理
  if (!response.ok) {
    return new Response(await response.text(), {
      status: response.status,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  // 把流式响应原样转发给前端
  return new Response(response.body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    }
  })
}