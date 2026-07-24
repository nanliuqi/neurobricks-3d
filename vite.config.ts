import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'

export default defineConfig({
  plugins: [
    react(),
    // 仅在 ANALYZE 环境变量存在时生成 bundle 分析报告
    process.env.ANALYZE && visualizer({ open: true, filename: 'dist/stats.html', gzipSize: true }),
  ].filter(Boolean),
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
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'three-vendor': ['three', '@react-three/fiber', '@react-three/drei'],
          'dnd-vendor': ['@dnd-kit/core'],
        },
      },
    },
  },
})
