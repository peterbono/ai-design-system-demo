import { defineConfig } from 'vitest/config';

// Unit tests for keyboard and ARIA behavior of the React components (jsdom + Testing Library + axe-core).
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'jsdom',
    include: ['packages/react/src/**/*.test.tsx'],
    setupFiles: ['./packages/react/src/test/setup.ts'],
    css: { modules: { classNameStrategy: 'non-scoped' } },
    pool: 'threads',
    maxWorkers: 2,
    testTimeout: 15000,
  },
});
