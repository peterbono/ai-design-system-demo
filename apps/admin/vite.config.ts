import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// The admin consumes the design system from source, like Storybook does, so a token or component change
// shows up here without a publish step. Aliases point at this checkout's packages.
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: [
      { find: '@demo-ds/react/styles.css', replacement: root('../../packages/react/src/styles/base.css') },
      { find: /^@demo-ds\/react$/, replacement: root('../../packages/react/src/index.ts') },
      { find: '@demo-ds/tokens/tokens.css', replacement: root('../../packages/tokens/dist/tokens.css') },
      { find: '@demo-ds/tokens/fonts.css', replacement: root('../../packages/tokens/fonts.css') },
      { find: /^@demo-ds\/tokens$/, replacement: root('../../packages/tokens/dist/tokens.ts') },
      // The data generator imports the full faker build (every locale, about 2 MB). English is enough.
      { find: /^@faker-js\/faker$/, replacement: '@faker-js/faker/locale/en' },
    ],
    dedupe: ['react', 'react-dom'],
  },
  server: {
    port: 5180,
    // node_modules may be a symlink to a sibling checkout (git worktrees): allow serving files from it.
    fs: { allow: [root('../..'), realpathSync(root('../../node_modules'))] },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          ra: ['ra-core', 'react-hook-form', '@tanstack/react-query', 'react-router', 'react-router-dom'],
          data: ['data-generator-retail', 'ra-data-fakerest'],
          charts: ['recharts'],
        },
      },
    },
  },
});
