// Static docs site. React is used at build time only, to render the real components to HTML;
// no component ships client JavaScript (no client:* directives anywhere).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@astrojs/react';
import { defineConfig } from 'astro/config';
import { REDIRECTS } from './src/lib/redirects.ts';

/**
 * Astro writes a meta refresh page for each redirect, which drops the query string and the hash. Old deep links
 * carry state there (/reviews/?pr=12, /foundations/lookup/?q=...), so each redirect page also gets a one-line
 * script that forwards them. The meta refresh stays as the no-JS fallback.
 */
const keepQuery = {
  name: 'bridge-redirects-keep-query',
  hooks: {
    'astro:build:done': ({ dir }) => {
      for (const [from, to] of Object.entries(REDIRECTS)) {
        const file = fileURLToPath(new URL(`.${from}/index.html`, dir));
        if (!existsSync(file)) continue;
        const html = readFileSync(file, 'utf8');
        const script = `<script>location.replace(${JSON.stringify(to)}+location.search+location.hash)</script>`;
        if (!html.includes(script)) writeFileSync(file, html.replace('<meta http-equiv', `${script}\n<meta http-equiv`));
      }
    },
  },
};

// Absolute URLs (canonical, sitemap): SITE_URL, else the branch URL of a preview host. The site is always served
// from the domain root: page links are root-relative.
const previewHost = process.env.VERCEL_ENV === 'preview' && process.env.VERCEL_BRANCH_URL ? `https://${process.env.VERCEL_BRANCH_URL}` : undefined;
const site = process.env.SITE_URL || previewHost || process.env.CF_PAGES_URL || process.env.DEPLOY_PRIME_URL || undefined;

export default defineConfig({
  output: 'static',
  site,
  trailingSlash: 'ignore',
  integrations: [react(), keepQuery],
  redirects: REDIRECTS,
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
