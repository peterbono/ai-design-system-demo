// Static docs site. React is used at build time only, to render the real components to HTML;
// no component ships client JavaScript (no client:* directives anywhere).
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@astrojs/react';
import { defineConfig } from 'astro/config';
import { REDIRECTS, redirectScript } from './src/lib/redirects.ts';
import { INLINE_SCRIPT_HASHES, inlineScripts } from './src/lib/csp.ts';

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
        const script = redirectScript(to);
        if (!html.includes(script)) writeFileSync(file, html.replace('<meta http-equiv', `${script}\n<meta http-equiv`));
      }
    },
  },
};

/**
 * The Content-Security-Policy allows inline scripts by hash only (src/lib/csp.ts). After the build, every inline
 * script of every page is hashed; one that the policy does not list fails the build with the hash to add, so the
 * policy never silently blocks a script once it is enforced. Runs after keepQuery (redirect pages get their script).
 */
const cspHashes = {
  name: 'bridge-csp-hashes',
  hooks: {
    'astro:build:done': ({ dir, logger }) => {
      const root = fileURLToPath(dir);
      const walk = (d) => readdirSync(d).flatMap((f) => {
        const p = join(d, f);
        return statSync(p).isDirectory() ? walk(p) : p.endsWith('.html') ? [p] : [];
      });
      const allowed = new Set(INLINE_SCRIPT_HASHES);
      const missing = new Map();
      for (const file of walk(root)) {
        for (const body of inlineScripts(readFileSync(file, 'utf8'))) {
          const hash = `sha256-${createHash('sha256').update(body).digest('base64')}`;
          if (!allowed.has(hash) && !missing.has(hash)) missing.set(hash, `${file.slice(root.length)}: ${body.trim().slice(0, 60)}`);
        }
      }
      if (missing.size) {
        const list = [...missing].map(([h, where]) => `  '${h}'  (${where})`).join('\n');
        throw new Error(`Inline scripts missing from the Content-Security-Policy. Add these hashes to INLINE_SCRIPT_HASHES in src/lib/csp.ts and to apps/docs-site/vercel.json (csp.test.ts prints the header):\n${list}`);
      }
      logger.info(`CSP: every inline script is one of the ${allowed.size} hashes in the policy.`);
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
  integrations: [react(), keepQuery, cspHashes],
  redirects: REDIRECTS,
  build: { format: 'directory' },
  devToolbar: { enabled: false },
  vite: {
    // Scripts always ship as files (never inlined into the page), so the CSP lists a few stable hashes, not one per build.
    build: { assetsInlineLimit: 0 },
    // Workspace packages export TypeScript sources under the `source` condition; resolve those (not the built
    // dist) and let Vite transform them instead of treating them as prebuilt deps.
    resolve: { conditions: ['source', 'module', 'browser', 'development|production'] },
    ssr: {
      noExternal: ['@bridge-ds/react', '@bridge-ds/tokens', '@bridge-ds/core'],
      resolve: { conditions: ['source', 'module', 'node', 'development|production'] },
    },
  },
});
