// Static docs site. React is used at build time only, to render the real components to HTML;
// no component ships client JavaScript (no client:* directives anywhere).
import react from '@astrojs/react';
import { defineConfig } from 'astro/config';

// Absolute URLs (canonical, sitemap): SITE_URL, else the branch URL of a preview host. The site is always served
// from the domain root: page links are root-relative.
const previewHost = process.env.VERCEL_ENV === 'preview' && process.env.VERCEL_BRANCH_URL ? `https://${process.env.VERCEL_BRANCH_URL}` : undefined;
const site = process.env.SITE_URL || previewHost || process.env.CF_PAGES_URL || process.env.DEPLOY_PRIME_URL || undefined;

export default defineConfig({
  output: 'static',
  site,
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
