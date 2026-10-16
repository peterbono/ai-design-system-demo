import { defineConfig } from 'vitest/config';

// Two projects:
//   react  keyboard and ARIA behavior of the React components (jsdom + Testing Library + axe-core)
//   core   @bridge/core, pure token logic (node)
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    pool: 'threads',
    maxWorkers: 2,
    testTimeout: 15000,
    projects: [
      {
        extends: true,
        test: {
          name: 'react',
          environment: 'jsdom',
          include: ['packages/react/src/**/*.test.tsx'],
          setupFiles: ['./packages/react/src/test/setup.ts'],
          css: { modules: { classNameStrategy: 'non-scoped' } },
        },
      },
      {
        extends: true,
        test: {
          name: 'core',
          environment: 'node',
          include: ['packages/core/test/**/*.test.ts'],
        },
      },
    ],
  },
});
