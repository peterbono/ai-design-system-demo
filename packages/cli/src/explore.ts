// bridge explore: start, list, promote and close explorations (explore/<slug> branches with a draft pull request
// labeled exploration, previews and snapshot packages for a product staging branch). See docs/EXPLORATIONS.md.
import { EXPLORATION_STATUS_LABEL, EXPLORATION_USE_CASES } from '@bridge-ds/core';
import { BridgeContext, explorations } from '@bridge-ds/mcp';
import { defaultIO, RequestUsageError, type RequestArgs, type RequestIO } from './request.js';

export const EXPLORE_HELP = `bridge explore: explorations, to try experimental variables and components in a product
staging branch without touching main (an explore/<name> branch with a draft pull request labeled exploration)

Usage:
  bridge explore start <name> --purpose "..." [--use-case ${EXPLORATION_USE_CASES.map((u) => u.value).join('|')}]
                       [--experimental "..." ...] [--dry-run] [--json]
                     GitHub token: the branch and the draft pull request on GitHub. Without one, in a git repo:
                     a local branch only, nothing pushed
  bridge explore list [--all] [--json]
                     running and promoted explorations, with the preview links Vercel reports, the install
                     command from the pull request (once the snapshot is built) and the requests implemented
                     on each (--all: closed ones too)
  bridge explore promote <name|#pr> [--dry-run] [--json]
                     ready for review, tier labels, exploration label and note removed (never merges)
  bridge explore close <name|#pr> [--json]
                     close it without merging; the branch stays

Work on one: git switch explore/<name>, then \`bridge propose --branch explore/<name> ...\`,
\`bridge request implement <n> --branch explore/<name>\`, or Claude with the Bridge MCP server.
GitHub token: GITHUB_TOKEN or BRIDGE_GITHUB_TOKEN, else \`gh auth token\`.
Exit codes: 0 ok, 2 usage or setup error.`;

const flag = (a: RequestArgs, k: string) => a.flags[k]?.[a.flags[k]!.length - 1];
const has = (a: RequestArgs, k: string) => Boolean(a.flags[k]);

async function context(root: string, io: RequestIO): Promise<BridgeContext> {
  const token = io.env.BRIDGE_GITHUB_TOKEN || io.env.GITHUB_TOKEN || io.ghToken();
  return BridgeContext.create({ root, ...(token ? { token } : {}), ...(io.fetch ? { fetch: io.fetch } : {}) });
}

/** Where the exploration comes from: the CLI, run by Claude Code when it sets CLAUDECODE in the shell it runs. */
const exploreSource = (env: NodeJS.ProcessEnv) => ({ source: 'cli' as const, ...(env.CLAUDECODE ? { agent: 'claude' } : {}) });

const date = (iso: string) => (iso ? iso.slice(0, 10) : '');

export async function runExplore(a: RequestArgs, root: string, io: RequestIO = defaultIO()): Promise<number> {
  const sub = a._[1];
  if (!sub || sub === 'help' || has(a, 'help')) {
    io.print(EXPLORE_HELP);
    return sub || has(a, 'help') ? 0 : 2;
  }
  const json = has(a, 'json');
  switch (sub) {
    case 'start': {
      const name = a._.slice(2).join(' ').trim() || flag(a, 'name');
      const purpose = flag(a, 'purpose');
      if (!name || !purpose) throw new RequestUsageError('Usage: bridge explore start <name> --purpose "What you want to learn"');
      const useCase = flag(a, 'use-case');
      const ctx = await context(root, io);
      const r = (await explorations.startExploration(ctx, { name, purpose, ...exploreSource(io.env), ...(useCase ? { useCase } : {}), ...(a.flags.experimental ? { experimental: a.flags.experimental } : {}), dryRun: has(a, 'dry-run') })) as Record<string, any>;
      if (json) return io.print(JSON.stringify(r, null, 2)), 0;
      if (r.status === 'dry-run') {
        io.print(`Dry run, nothing written.\n\nBranch: ${r.branch} (from ${r.base})\nPull request: ${r.title} (draft, label ${r.label})\nNote: ${r.note.path}\n\n${r.prBody}`);
        return 0;
      }
      if (r.status === 'started') {
        io.print(`Started ${r.branch}: draft pull request #${r.pr} ${r.url}`);
        // Nothing is built yet: the command and the real preview links come from the pull request once they exist.
        io.print(`\n${r.install.note}`);
        for (const p of r.previews ?? []) io.print(`${p.label}: ${p.url}`);
      } else io.print(`Created the local branch ${r.branch} (${String(r.commit).slice(0, 7)}).`);
      io.print(`\nNext: ${r.next}`);
      return 0;
    }
    case 'list': {
      const ctx = await context(root, io);
      const r = await explorations.listExplorations(ctx, { state: has(a, 'all') ? 'all' : 'open' });
      if (json) return io.print(JSON.stringify(r, null, 2)), 0;
      io.print(r.summary);
      for (const x of r.explorations) {
        io.print(`\n#${x.number} ${x.name}  ${EXPLORATION_STATUS_LABEL[x.status]}  ${x.branch}  @${x.author}  ${date(x.updatedAt)}`);
        if (x.purpose) io.print(`  ${x.purpose}`);
        io.print(`  ${x.url}`);
        for (const p of x.previews as { label: string; url: string | null; state?: string }[]) io.print(`  ${p.label}: ${p.url ? `${p.url}${p.state === 'building' ? ' (building)' : p.state === 'failed' ? ' (build failed)' : ''}` : 'link not reported by Vercel yet, see the pull request'}`);
        if (x.install) io.print(x.install.command ? `  Install: ${x.install.command}` : `  Install: ${x.install.note}`);
        if (x.requests.length) io.print(`  Requests: ${x.requests.map((q) => `#${q.number}`).join(', ')}`);
      }
      for (const b of r.localBranches ?? []) io.print(`\nLocal only: ${b} (push it and open a draft pull request labeled exploration)`);
      if (!r.explorations.length) io.print('Start one: bridge explore start "Pill buttons" --purpose "Do rounder buttons feel friendlier?"');
      return 0;
    }
    case 'promote': {
      const ref = a._.slice(2).join(' ').trim();
      if (!ref) throw new RequestUsageError('Usage: bridge explore promote <name|#pr> [--dry-run]');
      const ctx = await context(root, io);
      const r = (await explorations.promoteExploration(ctx, { ref, dryRun: has(a, 'dry-run') })) as Record<string, any>;
      if (json) return io.print(JSON.stringify(r, null, 2)), 0;
      io.print(`${r.status === 'dry-run' ? 'Dry run: would promote' : 'Promoted'} #${r.number} "${r.title}" to review: Tier ${r.tier}.`);
      io.print(`Labels: +${r.addLabels.join(', +')}, -${r.removeLabels.join(', -')}${r.removeFiles.length ? `. Removes ${r.removeFiles.join(', ')}` : ''}.`);
      if (r.closes.length) io.print(`Closes requests #${r.closes.join(', #')} when it merges.`);
      for (const w of r.warnings) io.error(`Warning: ${w}`);
      io.print(r.url);
      return 0;
    }
    case 'close': {
      const ref = a._.slice(2).join(' ').trim();
      if (!ref) throw new RequestUsageError('Usage: bridge explore close <name|#pr>');
      const ctx = await context(root, io);
      const r = await explorations.closeExploration(ctx, { ref });
      if (json) return io.print(JSON.stringify(r, null, 2)), 0;
      io.print(`Closed #${r.number} (${r.branch}). The branch stays; the preview prerelease is removed. ${r.url}`);
      return 0;
    }
    default:
      throw new RequestUsageError(`Unknown explore command "${sub}".\n\n${EXPLORE_HELP}`);
  }
}
