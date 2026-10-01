import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  
  return {
    plugins: [vue()],
    server: {
      proxy: {
        '/api/chat': {
          target: 'https://api.deepseek.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/chat$/, '/chat/completions'),
          headers: {
            Authorization: `Bearer ${env.VITE_DEEPSEEK_API_KEY}`
          }
        }
      }
    }
  }
})