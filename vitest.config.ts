import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
    // 涉及 D1 的测试要靠 wrangler getPlatformProxy() 起一个本地 miniflare
    // 子进程模拟真实 binding，冷启动比普通单测慢很多，默认 5s 撑不住。
    testTimeout: 20000,
    hookTimeout: 20000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
