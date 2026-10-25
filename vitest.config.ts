import { defineConfig, configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['./src/__tests__/setup.ts'],
    // 排除 e2e/playwright 用例（*.spec.ts 由 playwright 自行运行，不属于 vitest 收集范围）
    exclude: [...configDefaults.exclude, '**/e2e/**', '**/*.spec.ts'],
  },
});
