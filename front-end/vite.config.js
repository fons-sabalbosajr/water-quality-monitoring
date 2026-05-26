import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, projectRoot, '')
  const host = env.VITE_HOST || '10.14.77.183'

  return {
    base: '/water-quality-monitoring/',
    plugins: [react()],
    define: {
      CESIUM_BASE_URL: JSON.stringify('/water-quality-monitoring/cesium'),
    },
    server: {
      host, // bind to specific IP from .env, or all interfaces
      port: Number(env.VITE_PORT || 5173),
      proxy: {
        '/api': {
          target: env.VITE_API_TARGET || 'http://localhost:5000',
          changeOrigin: true,
        },
      },
    },
  }
})
