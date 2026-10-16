import { fileURLToPath } from 'node:url';
import { defaultServerConditions } from 'vite';
import { defineConfig } from 'vitest/config';

// Node tests for the MCP server and the CLI. Both packages build to dist first (the protocol smoke test spawns dist).
export default defineConfig({
  // Workspace packages resolve to their TypeScript sources (the `source` export condition).
  resolve: { conditions: ['source', ...defaultServerConditions] },
  ssr: { resolve: { conditions: ['source', ...defaultServerConditions] } },
  test: {
    environment: 'node',
    root: fileURLToPath(new URL('../..', import.meta.url)),
    include: ['packages/mcp/test/**/*.test.ts', 'packages/cli/test/**/*.test.ts'],
    globalSetup: ['packages/mcp/test/global-setup.ts'],
    pool: 'forks',
    maxWorkers: 2,
    testTimeout: 30000,
  },
});
