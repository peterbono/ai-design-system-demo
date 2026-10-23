#!/usr/bin/env node
// Vercel "Ignored Build Step" for the three preview projects (docs, storybook, admin). Vercel runs it before each
// build: exit 0 skips the build, exit 1 builds. A deploy is skipped only when we can prove nothing it depends on
// changed; any doubt (git error, no merge-base in a shallow clone) builds.
//
// What "changed" means depends on the branch:
//   main         since the last deployed commit (VERCEL_GIT_PREVIOUS_SHA, else HEAD^).
//   any other    since the merge-base with origin/main, so the first push of a branch with several commits
//                sees all of them, not only the last one. Vercel clones shallow: main is fetched if missing.
//   agent/*      never previewed: agent branches are validated by the GitHub checks and only deploy once merged,
//                which keeps Vercel under its daily deployment limit.
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

export const MAIN = 'main';
/** Branches that never get a preview deploy. */
export const NO_PREVIEW = ['agent/'];

/** True when any changed file is an input of the app. Unknown apps always build. */
export function shouldBuild(app, changedFiles) {
  const paths = APP_PATHS[app];
  if (!paths) return true;
  return changedFiles.some((file) => paths.some((p) => (p.endsWith('/') ? file.startsWith(p) : file === p)));
}

/**
 * Decides whether to build `app`. `git(args)` runs git and returns stdout, throwing on failure; it is injected so
 * the decision is unit tested without a repository. Returns { build, base, reason }.
 */
export function decide(app, { ref = '', previousSha = '', repoUrl = '' } = {}, git) {
  if (NO_PREVIEW.some((prefix) => ref.startsWith(prefix))) {
    return { build: false, base: null, reason: `${ref} is an agent branch, no preview: it deploys once merged.` };
  }
  let base;
  try {
    base = ref === MAIN ? previousSha || 'HEAD^' : mergeBase(git, repoUrl);
  } catch (err) {
    return { build: true, base: null, reason: `cannot find what changed (${firstLine(err)}), building ${app}.` };
  }
  let files;
  try {
    files = git(['diff', '--name-only', base, 'HEAD']).split('\n').filter(Boolean);
  } catch (err) {
    return { build: true, base, reason: `cannot diff against ${short(base)} (${firstLine(err)}), building ${app}.` };
  }
  const since = ref === MAIN ? `since ${short(base)}` : `since the merge-base with ${MAIN} (${short(base)})`;
  return shouldBuild(app, files)
    ? { build: true, base, reason: `${app} inputs changed ${since}, building.` }
    : { build: false, base, reason: `nothing ${app} depends on changed ${since}, skipping this build.` };
}

/** Merge-base of HEAD and origin/main. Fetches main (and deepens HEAD) when the shallow clone lacks it. */
function mergeBase(git, repoUrl) {
  const attempt = () => git(['merge-base', `origin/${MAIN}`, 'HEAD']).trim();
  try {
    return attempt();
  } catch {
    /* fall through: fetch and retry */
  }
  const refspec = `+refs/heads/${MAIN}:refs/remotes/origin/${MAIN}`;
  const remotes = ['origin', repoUrl].filter(Boolean);
  let fetched = false;
  for (const remote of remotes) {
    try {
      git(['fetch', '--no-tags', '--depth=50', remote, refspec]);
      fetched = true;
      break;
    } catch {
      /* try the next remote */
    }
  }
  if (!fetched) throw new Error(`cannot fetch ${MAIN}`);
  try {
    return attempt();
  } catch {
    /* HEAD history may be too shallow to reach the fork point */
  }
  try {
    git(['fetch', '--no-tags', '--deepen=50', remotes[0]]);
  } catch {
    /* keep going: the last attempt decides */
  }
  return attempt();
}

const short = (sha) => (/^[0-9a-f]{40}$/.test(sha) ? sha.slice(0, 7) : sha);
const firstLine = (err) => String(err?.message ?? err).split('\n')[0];

function runGit(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const app = process.argv[2] ?? '';
  const owner = process.env.VERCEL_GIT_REPO_OWNER;
  const slug = process.env.VERCEL_GIT_REPO_SLUG;
  const { build, reason } = decide(
    app,
    {
      ref: process.env.VERCEL_GIT_COMMIT_REF ?? '',
      previousSha: process.env.VERCEL_GIT_PREVIOUS_SHA ?? '',
      repoUrl: owner && slug ? `https://github.com/${owner}/${slug}.git` : '',
    },
    runGit,
  );
  console.log(`vercel-ignore: ${reason}`);
  process.exit(build ? 1 : 0);
}
