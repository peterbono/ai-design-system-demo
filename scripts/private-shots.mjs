#!/usr/bin/env node
// Private shots: captures of the explorations of private design copies, kept by Bridge (apps/docs-site/api/_lib/
// private-shots.ts) instead of a public branch. Run by .github/workflows/private-shots.yml in Bridge's own repository:
//
//   node scripts/private-shots.mjs [--base https://bridge.floriangouloubi.com] [--dry-run]
//
// Asks Bridge which explorations need a capture (GET /api/contribute?shots=todo), fills each preview template with
// @bridge-ds/core previewUrl (the branch, as the host names it), captures it with scripts/preview-shots.mjs captureOne
// and sends the webp back (POST ?shots=put). Both calls carry this workflow's GitHub OIDC token (audience
// bridge-shots): no stored secret. A preview that is not up yet, or that answers a sign-in page, is skipped and asked
// again on the next run.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { captureOne, launch } from './preview-shots.mjs';

export const AUDIENCE = 'bridge-shots';

/** The GitHub Actions OIDC token for Bridge, from the runner's request URL and token. */
export async function oidcToken(env = process.env, f = fetch) {
  const url = env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const bearer = env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!url || !bearer) throw new Error('No OIDC token: the workflow needs permissions: id-token: write.');
  const res = await f(`${url}&audience=${AUDIENCE}`, { headers: { authorization: `Bearer ${bearer}` } });
  if (!res.ok) throw new Error(`OIDC token request answered ${res.status}`);
  return (await res.json()).value;
}

/** A page that is a host's sign-in or "not found" page, never the product: not kept. */
export function looksLikeAWall(finalUrl) {
  try {
    const u = new URL(finalUrl);
    return /(^|\.)vercel\.com$/.test(u.hostname) || /\/login|\/sso|cdn-cgi\/access/.test(u.pathname);
  } catch {
    return true;
  }
}

function args(argv) {
  const o = { base: 'https://bridge.floriangouloubi.com', dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--base') o.base = argv[++i].replace(/\/$/, '');
    else if (argv[i] === '--dry-run') o.dryRun = true;
  }
  return o;
}

async function main() {
  const o = args(process.argv.slice(2));
  const require = createRequire(resolve(process.env.BRIDGE_DEPS ?? '.', 'package.json'));
  const core = await import(pathToFileURL(require.resolve('@bridge-ds/core')).href);
  const token = await oidcToken();
  const auth = { authorization: `Bearer ${token}` };
  const todo = await fetch(`${o.base}/api/contribute?shots=todo`, { headers: { ...auth, accept: 'application/json' } });
  if (!todo.ok) throw new Error(`Bridge answered ${todo.status} to the todo list: ${await todo.text()}`);
  const { jobs = [] } = await todo.json();
  console.log(`${jobs.length} exploration(s) to capture.`);
  if (!jobs.length) return;
  const browser = await launch();
  let kept = 0;
  try {
    for (const j of jobs) {
      const url = core.previewUrl(j.template, { branch: j.branch, pr: j.pr, sha: j.sha });
      if (!url) {
        console.log(`- ${j.repo}#${j.pr}: no preview address from ${j.template}`);
        continue;
      }
      try {
        const shot = await captureOne(browser, url);
        if (looksLikeAWall(new URL(shot.route, url).href)) {
          console.log(`- ${j.repo}#${j.pr}: ${url} asks to sign in, skipped`);
          continue;
        }
        if (o.dryRun) {
          console.log(`- ${j.repo}#${j.pr}: captured ${url} (dry run, not sent)`);
          continue;
        }
        const put = await fetch(`${o.base}/api/contribute?shots=put`, {
          method: 'POST',
          headers: { ...auth, 'content-type': 'application/json' },
          body: JSON.stringify({ repo: j.repo, pr: j.pr, sha: j.sha, url, image: Buffer.from(shot.webp).toString('base64') }),
        });
        console.log(`- ${j.repo}#${j.pr}: ${put.ok ? 'kept' : `refused (${put.status})`} ${url}`);
        if (put.ok) kept++;
      } catch (e) {
        console.log(`- ${j.repo}#${j.pr}: ${url} could not be captured (${e.message})`);
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`${kept} capture(s) kept by Bridge.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
