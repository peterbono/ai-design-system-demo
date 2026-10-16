import { defaultClientConditions, defaultServerConditions } from 'vite';
import { defineConfig } from 'vitest/config';

// Two projects:
//   react  keyboard and ARIA behavior of the React components (jsdom + Testing Library + axe-core)
//   core   @bridge-ds/core, pure token logic (node)
//   docs   docs-site data layer: token review, review rules, token editor model (node)
//   admin  back-office demo data layer: browser persistence of the demo dataset (node)
//   scripts repo scripts with logic (Vercel ignored build step)
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  // Workspace packages export their TypeScript sources under the `source` condition (built files otherwise).
  resolve: { conditions: ['source', ...defaultClientConditions] },
  ssr: { resolve: { conditions: ['source', ...defaultServerConditions] } },
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
          name: 'docs',
          environment: 'node',
          include: ['apps/docs-site/src/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'scripts',
          environment: 'node',
          include: ['scripts/**/*.test.mjs'],
        },
      },
      {
        extends: true,
        test: {
          name: 'admin',
          environment: 'node',
          include: ['apps/admin/src/**/*.test.ts'],
        },
      },
    ],
  },
});
