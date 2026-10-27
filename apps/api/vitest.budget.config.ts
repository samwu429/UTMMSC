import { defineConfig } from 'vitest/config';

// The row budget check (npm run test:budget): only src/**/*.budget.ts, which start a real local D1 engine, so the
// normal npm run test never runs them.
// 行数预算检查（npm run test:budget）：只包含 src/**/*.budget.ts，它们会启动真实的本地 D1 引擎，因此平常的 npm run test 从不运行它们。
export default defineConfig({
  test: {
    include: ['src/**/*.budget.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
