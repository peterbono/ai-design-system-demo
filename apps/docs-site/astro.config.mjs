// Static docs site. React is used at build time only, to render the real components to HTML;
// no component ships client JavaScript (no client:* directives anywhere).
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@astrojs/react';
import { defineConfig } from 'astro/config';
import { REDIRECTS, redirectScript } from './src/lib/redirects.ts';
import { INLINE_SCRIPT_HASHES, inlineScripts } from './src/lib/csp.ts';
import { RESERVED_PATHS_URL, reservedFromFiles } from './src/lib/team-path.ts';
import { checkTeamShells } from './src/lib/team-shells.ts';
import { checkLibraryHeaders, checkLibraryShells } from './src/lib/library-shells.ts';

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

/**
 * Team shells (src/lib/team-shells.ts). After the build: the paths a team address can never take are read from the
 * built Studio folder (not a hand-kept list) and written to /team-shell/reserved.json for the launcher, then the
 * build fails when a shell is missing or malformed, or when a page links to a Studio path that no file serves (the
 * rewrite would open it as a team instead of a 404). Library shells (src/lib/library-shells.ts) are checked too, and
 * no file may sit at /library/<owner>/<repo>/ (it would take that team's Library address). vercel.json must carry the
 * Library noindex rules that hosted/public-libraries.json implies (the error prints them).
 */
const teamShells = {
  name: 'bridge-team-shells',
  hooks: {
    'astro:build:done': ({ dir, logger }) => {
      const root = fileURLToPath(dir);
      const walk = (d) => readdirSync(d).flatMap((f) => {
        const p = join(d, f);
        return statSync(p).isDirectory() ? walk(p) : [relative(root, p).split(sep).join('/')];
      });
      const files = walk(root);
      const reserved = reservedFromFiles(files.filter((f) => f.startsWith('studio/')).map((f) => f.slice('studio/'.length)));
      const out = join(root, RESERVED_PATHS_URL);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, `${JSON.stringify(reserved)}\n`);
      const read = (f) => readFileSync(join(root, f), 'utf8');
      // The noindex header rules of team Libraries follow the committed allow-list (hosted/public-libraries.json).
      const vercelJson = JSON.parse(readFileSync(new URL('./vercel.json', import.meta.url), 'utf8'));
      const publicLibraries = JSON.parse(readFileSync(new URL('./hosted/public-libraries.json', import.meta.url), 'utf8')).libraries;
      const problems = [...checkTeamShells(files, read), ...checkLibraryShells(files, read), ...checkLibraryHeaders(vercelJson.headers, publicLibraries)];
      if (problems.length) throw new Error(`Team shells:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
      logger.info(`Team shells: checked (Studio and Library); ${reserved.pairs.length} reserved owner/repo pairs written to ${RESERVED_PATHS_URL}.`);
    },
  },
};

// Absolute URLs (canonical, sitemap): SITE_URL, else the branch URL of a preview host. The site is always served
// from the domain root: page links are root-relative.
const previewHost = process.env.VERCEL_ENV === 'preview' && process.env.VERCEL_BRANCH_URL ? `https://${process.env.VERCEL_BRANCH_URL}` : undefined;
const site = process.env.SITE_URL || previewHost || process.env.CF_PAGES_URL || process.env.DEPLOY_PRIME_URL || undefined;

// `npm run dev:full` (BRIDGE_LOCAL=1): the api/* functions run inside the dev server with local data only
// (dev/local-api.ts). Never loaded otherwise, so the build and Vercel never see it.
const local = process.env.BRIDGE_LOCAL === '1' ? [(await import('./dev/local-api.ts')).bridgeLocal({ root: fileURLToPath(new URL('.', import.meta.url)) })] : [];

export default defineConfig({
  output: 'static',
  site,
  trailingSlash: 'ignore',
  integrations: [react(), keepQuery, cspHashes, teamShells, ...local],
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
