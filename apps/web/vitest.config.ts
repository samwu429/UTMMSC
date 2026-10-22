import { defineConfig } from 'vitest/config';

/**
 * Unit tests run in Node without the PWA plugin, so modules under test must not touch window at
 * import time.
 * 单元测试在 Node 中运行，不加载 PWA 插件；被测模块在导入时不能访问 window。
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
