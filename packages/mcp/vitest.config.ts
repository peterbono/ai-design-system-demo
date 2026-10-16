import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Node tests for the MCP server and the CLI. Both packages build to dist first (the protocol smoke test spawns dist).
export default defineConfig({
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
