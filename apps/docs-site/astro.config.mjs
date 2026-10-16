// Static docs site. React is used at build time only, to render the real components to HTML;
// no component ships client JavaScript (no client:* directives anywhere).
import react from '@astrojs/react';
import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'static',
  site: process.env.SITE_URL || undefined,
  trailingSlash: 'ignore',
  integrations: [react()],
  build: { format: 'directory' },
  devToolbar: { enabled: false },
  vite: {
    // Workspace packages export TypeScript sources under the `source` condition; resolve those (not the built
    // dist) and let Vite transform them instead of treating them as prebuilt deps.
    resolve: { conditions: ['source', 'module', 'browser', 'development|production'] },
    ssr: {
      noExternal: ['@bridge-ds/react', '@bridge-ds/tokens', '@bridge-ds/core'],
      resolve: { conditions: ['source', 'module', 'node', 'development|production'] },
    },
  },
});
