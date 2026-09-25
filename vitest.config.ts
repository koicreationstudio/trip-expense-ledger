import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    // round66 新增第一个组件级测试（fx-compare-card.test.tsx）——这类测试需要
    // jsdom 环境（渲染真实 DOM、模拟点击），跟其它 *.test.ts 纯函数测试用的 node
    // 环境不一样。不整体切成 jsdom（会拖慢所有 lib 测试的启动），改用 vitest 支持
    // 的单文件 `// @vitest-environment jsdom` 注释局部覆盖——顶部 `environment`
    // 仍是全部 *.test.ts 文件的默认值，`**/*.test.tsx` 只是把 include 范围打开，
    // 每个 .tsx 测试文件自己声明要用哪个环境。
    include: ['**/*.test.ts', '**/*.test.tsx'],
    // fix(2026-09-26 第七十一轮)：`trip-expense-ledger-worktrees/` 是历史遗留的
    // worktree 目录，就嵌在主 checkout 内部（不是平级目录）。默认 exclude 只挡
    // `**/node_modules/**`，挡不住这个目录自己的 `.test.tsx` 文件——同一份逻辑
    // 测试文件（比如 expense-form.test.tsx）在主 checkout 和这个嵌套 worktree
    // 里各有一份，vitest 两份都会跑，各自解析到自己那份 node_modules 里的 React
    // 副本，组件测试渲染时两份 React 实例互不认识，报
    // "Cannot read properties of null (reading 'useState')"。显式排除这个目录
    // （以及同类的 `audit-diffs/` 历史产物目录，纯 html/图片不含测试但保险起见
    // 一并排除）根治，不是掩盖真实测试失败。
    exclude: ['**/node_modules/**', 'trip-expense-ledger-worktrees/**', 'audit-diffs/**'],
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
  // round66：组件测试渲染的是 app/ 下真实的 .tsx 源文件，那些文件本身没有 `import
  // React` （Next.js 的 SWC 构建管线自动注入 JSX runtime，vitest 走的是 vite/esbuild
  // 这条完全不同的编译路径，不会有这个魔法）。这里显式打开 esbuild 的自动 JSX
  // runtime，让 vitest 编译这些文件时跟生产构建行为一致，不用去改任何业务源文件。
  esbuild: {
    jsx: 'automatic',
  },
});
