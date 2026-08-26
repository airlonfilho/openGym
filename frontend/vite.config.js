import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const backend = process.env.API_TARGET || 'http://127.0.0.1:3000'
const media = process.env.MEDIA_TARGET || 'http://127.0.0.1:8888'

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    // Vite doesn't read $PORT on its own — honour it when set (tooling assigns one),
    // otherwise keep the usual 5173 and let Vite hop to the next free port.
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
    strictPort: !!process.env.PORT,
    proxy: {
      '/api': { target: backend, changeOrigin: true },
      '/img': { target: media, changeOrigin: true },
      '/gif': { target: media, changeOrigin: true }
    }
  },
  build: { chunkSizeWarningLimit: 1500 }
})
