import { defaultServerConditions } from 'vite';
import { defineConfig } from 'vitest/config';

// The quota load test (docs/QUOTA-LOADTEST.md), on its own: `npm run loadtest:github -w @bridge-ds/docs-site`.
// Not part of `npm test` (no default project includes test/quota); the quick smoke run is
// src/lib/quota-loadtest.test.ts.
export default defineConfig({
  resolve: { conditions: ['source', ...defaultServerConditions] },
  ssr: { resolve: { conditions: ['source', ...defaultServerConditions] } },
  test: {
    name: 'quota-loadtest',
    environment: 'node',
    include: ['apps/docs-site/test/quota/**/*.loadtest.ts'],
    testTimeout: 15 * 60 * 1000,
  },
});
