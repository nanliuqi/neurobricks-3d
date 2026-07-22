import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  server: {
    watch: {
      // 排除 Rust 编译产物，避免 EBUSY 崩溃
      ignored: ['**/src-tauri/target/**'],
    },
  },
})
