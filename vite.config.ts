/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5260,
    proxy: {
      '/api': { target: 'http://localhost:3080', changeOrigin: true },
      // Terowongan WebSocket ke server real-time.
      '/ws': { target: 'ws://localhost:3080', ws: true },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
