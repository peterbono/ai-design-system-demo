import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// What the Bridge toolbar (src/bridge) needs to know about this repository and this deploy, read once at build time:
// the repository, production Studio and admin, the admin preview template, and whether Vercel builds production.
const config = JSON.parse(readFileSync(root('../../bridge.config.json'), 'utf8')) as {
  repo: { owner: string; name: string; defaultBranch?: string };
  tokens?: { root?: string };
  previews?: { apps?: { admin?: string }; production?: { docs?: string; admin?: string } };
};
const bridgeBuild = {
  owner: config.repo.owner,
  repo: config.repo.name,
  studio: config.previews?.production?.docs ?? null,
  productionAdmin: config.previews?.production?.admin ?? null,
  adminTemplate: config.previews?.apps?.admin ?? null,
  deployEnv: process.env.VERCEL_ENV ?? null,
  defaultBranch: config.repo.defaultBranch ?? 'main',
  tokensRoot: config.tokens?.root ?? 'packages/tokens/src',
};

// The admin consumes the design system from source, like Storybook does, so a token or component change
// shows up here without a publish step. Aliases point at this checkout's packages.
export default defineConfig({
  // Served from the domain root on preview hosts (Vercel, Netlify, Cloudflare Pages). For a sub-path host
  // (GitHub Pages: /<repo>/admin/), build with BASE_PATH=/<repo>/admin/; the router follows import.meta.env.BASE_URL.
  base: process.env.BASE_PATH || '/',
  esbuild: { jsx: 'automatic' },
  define: { __BRIDGE_BUILD__: JSON.stringify(bridgeBuild) },
  resolve: {
    alias: [
      { find: '@bridge-ds/react/styles.css', replacement: root('../../packages/react/src/styles/base.css') },
      { find: /^@bridge-ds\/react$/, replacement: root('../../packages/react/src/index.ts') },
      { find: '@bridge-ds/tokens/tokens.css', replacement: root('../../packages/tokens/dist/tokens.css') },
      { find: '@bridge-ds/tokens/fonts.css', replacement: root('../../packages/tokens/fonts.css') },
      { find: /^@bridge-ds\/tokens$/, replacement: root('../../packages/tokens/dist/tokens.ts') },
      // Changes tried together combine token files in the browser (src/bridge/together.ts, loaded only then).
      { find: /^@bridge-ds\/core$/, replacement: root('../../packages/core/src/index.ts') },
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
