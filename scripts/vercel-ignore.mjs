#!/usr/bin/env node
// Vercel "Ignored Build Step" for the three preview projects (docs, storybook, admin). Vercel runs it before each
// build: exit 0 skips the build, exit 1 builds. A deploy is skipped only when we can prove nothing it depends on
// changed since the last deployed commit of this branch; any doubt (no previous SHA, shallow history) builds.
//
//   ignoreCommand in apps/docs-site/vercel.json:  node ../../scripts/vercel-ignore.mjs docs
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Paths each app is built from, relative to the repository root. Shared inputs first. */
const SHARED = ['packages/', 'package.json', 'package-lock.json', 'tsconfig.base.json', 'bridge.config.json', 'scripts/vercel-ignore.mjs'];
export const APP_PATHS = {
  docs: [...SHARED, 'apps/docs-site/', 'docs/', '.changeset/', 'AGENTS.md', 'README.md', '.github/CODEOWNERS'],
  storybook: [...SHARED, '.storybook/', 'deploy/storybook/'],
  admin: [...SHARED, 'apps/admin/'],
};

/** True when any changed file is an input of the app. Unknown apps always build. */
export function shouldBuild(app, changedFiles) {
  const paths = APP_PATHS[app];
  if (!paths) return true;
  return changedFiles.some((file) => paths.some((p) => (p.endsWith('/') ? file.startsWith(p) : file === p)));
}

function changedSince(base) {
  const out = execFileSync('git', ['diff', '--name-only', base, 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return out.split('\n').filter(Boolean);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const app = process.argv[2] ?? '';
  const base = process.env.VERCEL_GIT_PREVIOUS_SHA || 'HEAD^';
  let files;
  try {
    files = changedSince(base);
  } catch {
    console.log(`vercel-ignore: cannot diff against ${base}, building ${app}.`);
    process.exit(1);
  }
  if (shouldBuild(app, files)) {
    console.log(`vercel-ignore: ${app} inputs changed since ${base.slice(0, 7)}, building.`);
    process.exit(1);
  }
  console.log(`vercel-ignore: nothing ${app} depends on changed since ${base.slice(0, 7)}, skipping this build.`);
  process.exit(0);
}
