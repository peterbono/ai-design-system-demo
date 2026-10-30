// bridge explore: start, list, done (promote is its old name), archive and close explorations (explore/<slug> branches
// with a draft pull request labeled exploration, previews and snapshot packages for a product staging branch). See
// docs/EXPLORATIONS.md.
import { EXPLORATION_STATUS_LABEL, EXPLORATION_USE_CASES } from '@bridge-ds/core';
import { explorations } from '@bridge-ds/mcp';
import { defaultIO, RequestUsageError, type RequestArgs, type RequestIO } from './request.js';
import { cliContext, TOKEN_HELP, WRITE_TOKEN_HOW, type Access } from './auth.js';

export const EXPLORE_HELP = `bridge explore: explorations, to try experimental variables and components in a product
staging branch without touching main (an explore/<name> branch with a draft pull request labeled exploration)

Usage:
  bridge explore start <name> [--purpose "..."] [--use-case ${EXPLORATION_USE_CASES.map((u) => u.value).join('|')}]
                       [--experimental "..." ...] [--product <key>] [--in-library] [--dry-run] [--json]
                     GitHub token: the branch and the draft pull request on GitHub, in the product's own
                     repository when bridge.config.json gives it one (products[].repo), else in the design
                     system repository (--in-library: always there). Without a token, in a git repo: a local
                     branch only, nothing pushed. The purpose is optional
  bridge explore list [--all] [--archived] [--json]
                     running explorations and the ones with the developers, with the preview links Vercel
                     reports, the install command from the pull request (once the snapshot is built) and the
                     requests implemented on each (--all: closed ones too; --archived: only archived ones).
                     Explorations in a product's own repository are listed too, named product#pr (shop#12)
  bridge explore continue <#pr|product#pr|name> [--no-checkout] [--json]
                     pick one up where it was left ("Continue Bridge exploration #12"): switches this
                     checkout to its branch when nothing is uncommitted, then says where it stands
  bridge explore done <name|#pr|product#pr> [--piece <id> ...] [--dry-run] [--json]
                     done exploring: each --piece (ids from bridge pieces) becomes a request for the DS lead
                     with the preview link; the exploration label and note go, ready-for-devs comes, and
                     developers continue on the branch. Never closes, merges or marks it ready
                     (promote is the old name of done)
  bridge explore archive <name|#pr> [--json]
  bridge explore unarchive <name|#pr> [--json]
                     hide it from the lists (the archived label) or bring it back; the pull request and
                     its preview stay open
  bridge explore close <name|#pr> [--json]
                     close it without merging; the branch stays, the preview is removed (prefer archive)

Work on one: git switch explore/<name>, then \`bridge propose --branch explore/<name> ...\`,
\`bridge request implement <n> --branch explore/<name>\`, or Claude with the Bridge MCP server.
${TOKEN_HELP}
Exit codes: 0 ok, 2 usage or setup error.`;

const flag = (a: RequestArgs, k: string) => a.flags[k]?.[a.flags[k]!.length - 1];
const has = (a: RequestArgs, k: string) => Boolean(a.flags[k]);

const context = (root: string, io: RequestIO, a: RequestArgs, access: Access) => cliContext(root, io, a, access);

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
      if (!name) throw new RequestUsageError('Usage: bridge explore start <name> [--purpose "What you want to learn"]');
      const useCase = flag(a, 'use-case');
      const ctx = await context(root, io, a, has(a, 'dry-run') ? 'read' : 'write');
      const r = (await explorations.startExploration(ctx, { name, ...(purpose ? { purpose } : {}), ...(has(a, 'in-library') ? { where: 'library' as const } : {}), ...exploreSource(io.env), ...(useCase ? { useCase } : {}), ...(a.flags.experimental ? { experimental: a.flags.experimental } : {}), ...(flag(a, 'product') ? { product: flag(a, 'product') } : {}), dryRun: has(a, 'dry-run') })) as Record<string, any>;
      if (json) return io.print(JSON.stringify(r, null, 2)), 0;
      if (r.status === 'dry-run') {
        io.print(`Dry run, nothing written.\n\nBranch: ${r.branch} (from ${r.base}${r.repo ? ` in ${r.repo}` : ''})\nPull request: ${r.title} (draft, label ${r.label})\nNote: ${r.note.path}\n\n${r.prBody}`);
        return 0;
      }
      if (r.status === 'started') {
        io.print(`Started ${r.branch}${r.inProductRepo ? ` in ${r.repo}` : ''}: draft pull request #${r.pr} ${r.url}`);
        // Nothing is built yet: the command and the real preview links come from the pull request once they exist.
        if (r.install) io.print(`\n${r.install.note}`);
        for (const p of r.previews ?? []) io.print(`${p.label}: ${p.url}`);
      } else {
        io.print(`Created the local branch ${r.branch} (${String(r.commit).slice(0, 7)}).`);
        if (!ctx.canWriteRemote) io.print(`Nothing pushed: no GitHub token was passed. For the branch and its draft pull request on GitHub, ${WRITE_TOKEN_HOW}.`);
      }
      io.print(`\nNext: ${r.next}`);
      return 0;
    }
    case 'list': {
      const ctx = await context(root, io, a, 'read');
      const r = await explorations.listExplorations(ctx, { state: has(a, 'all') ? 'all' : 'open', archived: has(a, 'archived') });
      if (json) return io.print(JSON.stringify(r, null, 2)), 0;
      io.print(r.summary);
      for (const x of r.explorations) {
        io.print(`\n${x.ref} ${x.name}  ${EXPLORATION_STATUS_LABEL[x.status]}  ${x.branch}${x.repo ? ` in ${x.repo}` : ''}  @${x.author}  ${date(x.updatedAt)}`);
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
    case 'done':
    case 'promote': {
      const ref = a._.slice(2).join(' ').trim();
      if (!ref) throw new RequestUsageError('Usage: bridge explore done <name|#pr> [--piece <id> ...] [--dry-run]');
      const ctx = await context(root, io, a, has(a, 'dry-run') ? 'read' : 'write');
      const r = await explorations.doneExploring(ctx, { ref, pieces: a.flags.piece ?? [], dryRun: has(a, 'dry-run'), ...exploreSource(io.env) });
      if (json) return io.print(JSON.stringify(r, null, 2)), 0;
      const lead = r.status === 'dry-run' ? 'Dry run: done exploring' : r.status === 'already-done' ? 'Already done exploring' : 'Done exploring';
      io.print(`${lead} ${r.ref} (${r.branch}${r.repo ? ` in ${r.repo}` : ''}). Nothing closed or merged: the preview stays.${r.requestsIn && r.requests.length ? ` Requests go to ${r.requestsIn}.` : ''}`);
      if (r.labels) io.print(`Labels: +${r.labels.add.join(', +')}, -${r.labels.remove.join(', -')}${r.removeFiles.length ? `. Removes ${r.removeFiles.join(', ')}` : ''}.`);
      for (const q of r.requests) io.print(`${r.status === 'dry-run' ? 'Would request' : 'Requested'}: ${q.title}${q.number ? ` #${q.number} ${q.url}` : ''}`);
      for (const q of r.alreadySent) io.print(`Already sent: ${q.piece} #${q.number}`);
      for (const q of r.notProposed) io.print(`Not proposed: ${q.id} (${q.title})`);
      io.print(`\nFor developers: ${r.forDevelopers.take.join(' && ')}\n${r.forDevelopers.note}`);
      for (const w of r.warnings) io.error(`Warning: ${w}`);
      io.print(r.url);
      return 0;
    }
    case 'continue': {
      const ref = a._.slice(2).join(' ').trim();
      if (!ref) throw new RequestUsageError('Usage: bridge explore continue <#pr|product#pr|name>');
      const ctx = await context(root, io, a, 'read');
      const r = await explorations.continueExploration(ctx, { ref, checkout: !has(a, 'no-checkout') });
      if (json) return io.print(JSON.stringify(r, null, 2)), 0;
      io.print(`${r.ref} ${r.name} (${r.product}): ${r.whereItStands}`);
      for (const e of r.activity) io.print(`  ${e.who} ${e.what}, ${e.when}`);
      for (const p of r.previews) io.print(`  ${p.label}: ${p.url}`);
      io.print(`${r.checkout.note} ${r.url}`);
      return 0;
    }
    case 'archive':
    case 'unarchive': {
      const ref = a._.slice(2).join(' ').trim();
      if (!ref) throw new RequestUsageError(`Usage: bridge explore ${sub} <name|#pr>`);
      const ctx = await context(root, io, a, 'write');
      const r = await explorations.archiveExploration(ctx, { ref, archived: sub === 'archive' });
      if (json) return io.print(JSON.stringify(r, null, 2)), 0;
      io.print(`${r.archived ? 'Archived' : 'Unarchived'} ${r.ref} (${r.branch}). ${r.next} ${r.url}`);
      return 0;
    }
    case 'close': {
      const ref = a._.slice(2).join(' ').trim();
      if (!ref) throw new RequestUsageError('Usage: bridge explore close <name|#pr>');
      const ctx = await context(root, io, a, 'write');
      const r = await explorations.closeExploration(ctx, { ref });
      if (json) return io.print(JSON.stringify(r, null, 2)), 0;
      io.print(`Closed #${r.number} (${r.branch}). The branch stays; the preview prerelease is removed (archive keeps it). ${r.url}`);
      return 0;
    }
    default:
      throw new RequestUsageError(`Unknown explore command "${sub}".\n\n${EXPLORE_HELP}`);
  }
}
