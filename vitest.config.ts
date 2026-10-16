import { defineConfig } from 'vitest/config';

// Projects:
//   react  keyboard and ARIA behavior of the React components (jsdom + Testing Library + axe-core)
//   core   @bridge/core, pure token logic (node)
//   docs   docs-site data layer: token review, review rules, token editor model (node)
//   lint   @bridge/stylelint-plugin and @bridge/eslint-plugin rules (node)
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
      {
        extends: true,
        test: {
          name: 'lint',
          environment: 'node',
          include: ['packages/stylelint-plugin/test/**/*.test.ts', 'packages/eslint-plugin/test/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'docs',
          environment: 'node',
          include: ['apps/docs-site/src/**/*.test.ts'],
        },
      },
    ],
  },
});
