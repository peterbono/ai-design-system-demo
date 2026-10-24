// bridge branch, bridge products, bridge settings, bridge coverage, bridge docs save: the Bridge Studio actions from
// the terminal, over the same operations as the MCP server (packages/mcp/src/branches.ts and studio.ts), which call the
// same @bridge-ds/core functions as Studio. Reads work without a token on a public repo; writes need one.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { branches, isBlocked, studio } from '@bridge-ds/mcp';
import { defaultIO, RequestUsageError, type RequestArgs, type RequestIO } from './request.js';
import { changesFlag } from './suggest.js';
import { cliContext, TOKEN_HELP, type Access } from './auth.js';

export const BRANCH_HELP = `bridge branch: branches in review, the same actions as Bridge Studio

Usage:
  bridge branch list [--limit 20] [--json]      what needs me: the review queue, mine first
  bridge branch status <n> [--json]             status, approvals, tests, main, may I merge, next step
  bridge branch comments <n> [--json]           the conversation and line threads (ids to reply to)
  bridge branch ready <n>                       send a draft for review (its author)
  bridge branch draft <n>                       back to draft (its author)
  bridge branch review <n> --approve [--body "..."] | --request-changes "..." | --comment "..."
  bridge branch ask <n> [--dry-run]              ask someone else to review (who can give the missing approvals)
  bridge branch comment <n> "text" [--reply-to <id>]
  bridge branch merge <n> [--override "reason"] [--dry-run]
                                                the same verdict as Studio's Merge button: tests, no
                                                changes requested, Tier 1 one owner approval, Tier 2-3
                                                design and tech; a branch with "Closes #n" carries the
                                                approved suggestion's approvals (same or lower tier).
                                                --override: owners named in governance.override.allowed
                                                only, missing approvals only; the reason is always
                                                required (20 characters by default), posted first
  bridge branch close <n> | bridge branch reopen <n>
  bridge branch update <n> [--choice <key>=mine|theirs ...] [--dry-run]
                                                update from main; token conflicts: pick per key
  bridge branch try <n> [--json]                try it in a product, share it with a product team
  bridge branch combine <n> <n> [<n> <n>] [--pick <key>=<n> ...] [--json]
                                                try 2 to 4 token branches together (writes nothing)
  bridge products [--json]                      the products and the one this folder belongs to
  bridge settings [--json]                      roles, who ships, owner override, protection, products
  bridge coverage [Component] [--json]          which components are in Figma
  bridge docs save <Component> --file docs.json [--pr <n>] [--title "..."] [--jira DS-42]
                   [--product admin] [--dry-run] [--json]
                                                save usage guidance as in the Library edit mode

Start work for a product: bridge propose|explore start|request create ... --product <key> [--jira DS-42].
${TOKEN_HELP}
Exit codes: 0 ok, 1 blocked (merge: the gate said no), 2 usage or setup error.`;

const flag = (a: RequestArgs, k: string) => a.flags[k]?.[a.flags[k]!.length - 1];
const has = (a: RequestArgs, k: string) => Boolean(a.flags[k]);

/** What each branch command does on GitHub: the reads may borrow the gh sign-in, the writes never do. */
const BRANCH_WRITES = new Set(['ready', 'draft', 'review', 'ask', 'comment', 'merge', 'close', 'reopen', 'update']);
const context = (root: string, io: RequestIO, a: RequestArgs, access: Access) => cliContext(root, io, a, access);

function number(a: RequestArgs, at: number, usage: string): number {
  const raw = a._[at];
  if (!raw) throw new RequestUsageError(`Usage: ${usage}`);
  return branches.branchNumber(raw);
}

/** `key=value` flags into a record ("--choice semantic/light.tokens.json#color.text.muted=theirs"). The key may hold "=" never. */
function pairs(list: string[] | undefined, what: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of list ?? []) {
    const i = s.lastIndexOf('=');
    if (i <= 0) throw new RequestUsageError(`--${what} needs key=value, got "${s}".`);
    out[s.slice(0, i)] = s.slice(i + 1);
  }
  return out;
}

const said = (r: Record<string, unknown>) => String(r.said ?? r.summary ?? r.status ?? 'Done.');

export async function runBranch(a: RequestArgs, root: string, io: RequestIO = defaultIO()): Promise<number> {
  const sub = a._[1];
  if (!sub || sub === 'help' || has(a, 'help')) {
    io.print(BRANCH_HELP);
    return sub || has(a, 'help') ? 0 : 2;
  }
  const json = has(a, 'json');
  const ctx = await context(root, io, a, BRANCH_WRITES.has(sub) && !has(a, 'dry-run') ? 'write' : 'read');
  const out = (r: unknown, text: () => void) => (json ? io.print(JSON.stringify(r, null, 2)) : text(), 0);
  switch (sub) {
    case 'list': {
      const limit = flag(a, 'limit');
      const r = await branches.whatNeedsMe(ctx, limit ? { limit: Number(limit) } : {});
      return out(r, () => {
        io.print(r.summary);
        for (const b of r.branches) io.print(`#${b.pr}  ${b.statusLabel.padEnd(22)} ${b.title}${b.needsYou ? `  <- ${b.needsYou}` : ''}`);
      });
    }
    case 'status': {
      const r = (await branches.branchStatus(ctx, { pr: number(a, 2, 'bridge branch status <n>') })) as Record<string, any>;
      return out(r, () => {
        io.print(`#${r.pr} ${r.title} (${r.product.name})`);
        io.print(`${r.status.label}. ${r.approvalNeeded} needed; approved by ${r.approvals.approvedBy.map((x: string) => `@${x}`).join(', ') || 'nobody yet'}.`);
        if (r.approvals.soloOwner) io.print(r.approvals.soloOwner);
        if (r.approvals.carriedFrom) io.print(r.approvals.carriedFrom);
        io.print(`${r.tests.label}.`);
        if (r.merge.blockedBy?.length) for (const x of r.merge.blockedBy) io.print(`  ${x}`);
        io.print(`Next: ${r.next}`);
        io.print(r.url);
      });
    }
    case 'comments': {
      const r = await branches.listComments(ctx, { pr: number(a, 2, 'bridge branch comments <n>') });
      return out(r, () => {
        for (const c of r.conversation) io.print(`@${c.author}: ${c.body}`);
        for (const t of r.threads) io.print(`[thread ${t.id}] ${t.file}:${t.line ?? ''} @${t.author}: ${t.body}${t.replies.length ? ` (${t.replies.length} replies)` : ''}`);
      });
    }
    case 'ready': {
      const r = await branches.sendForReview(ctx, { pr: number(a, 2, 'bridge branch ready <n>') });
      return out(r, () => io.print(r.said));
    }
    case 'draft': {
      const r = await branches.backToDraft(ctx, { pr: number(a, 2, 'bridge branch draft <n>') });
      return out(r, () => io.print(r.said));
    }
    case 'review': {
      const n = number(a, 2, 'bridge branch review <n> --approve | --request-changes "..." | --comment "..."');
      const decision = has(a, 'approve') ? 'approve' : has(a, 'request-changes') ? 'request_changes' : has(a, 'comment') ? 'comment' : null;
      if (!decision) throw new RequestUsageError('Say what you decide: --approve, --request-changes "what to change" or --comment "text".');
      const body = decision === 'approve' ? flag(a, 'body') : flag(a, decision === 'request_changes' ? 'request-changes' : 'comment');
      const r = await branches.reviewBranch(ctx, { pr: n, decision, ...(body && body !== 'true' ? { body } : {}) });
      return out(r, () => io.print(r.said));
    }
    case 'ask': {
      const r = await branches.askSomeoneElse(ctx, { pr: number(a, 2, 'bridge branch ask <n>'), dryRun: has(a, 'dry-run') });
      return out(r, () => io.print(r.said));
    }
    case 'comment': {
      const n = number(a, 2, 'bridge branch comment <n> "text"');
      const body = a._.slice(3).join(' ') || flag(a, 'body');
      if (!body) throw new RequestUsageError('Usage: bridge branch comment <n> "text" [--reply-to <id>]');
      const reply = flag(a, 'reply-to');
      const r = await branches.commentOnBranch(ctx, { pr: n, body, ...(reply ? { replyTo: Number(reply) } : {}) });
      return out(r, () => io.print(r.said));
    }
    case 'merge': {
      const n = number(a, 2, 'bridge branch merge <n> [--override "reason"] [--dry-run]');
      const reason = flag(a, 'override');
      let r: Awaited<ReturnType<typeof branches.mergeBranch>>;
      try {
        r = await branches.mergeBranch(ctx, { pr: n, ...(reason ? { overrideReason: reason } : {}), dryRun: has(a, 'dry-run') });
      } catch (e) {
        // A rule said no (the merge gate, the owner override): exit 1, not a usage error.
        if (!isBlocked(e)) throw e;
        if (json) io.print(JSON.stringify({ pr: n, status: 'blocked', said: e.message }, null, 2));
        else io.error(`bridge: ${e.message}`);
        return 1;
      }
      out(r, () => io.print(r.said));
      return r.status === 'blocked' ? 1 : 0;
    }
    case 'close': {
      const r = await branches.closeBranch(ctx, { pr: number(a, 2, 'bridge branch close <n>') });
      return out(r, () => io.print(r.said));
    }
    case 'reopen': {
      const r = await branches.reopenBranch(ctx, { pr: number(a, 2, 'bridge branch reopen <n>') });
      return out(r, () => io.print(r.said));
    }
    case 'update': {
      const n = number(a, 2, 'bridge branch update <n> [--choice key=mine|theirs] [--dry-run]');
      const choices = pairs(a.flags.choice, 'choice');
      for (const [k, v] of Object.entries(choices)) if (v !== 'mine' && v !== 'theirs') throw new RequestUsageError(`--choice ${k}= takes mine or theirs, got "${v}".`);
      const r = (await branches.updateFromMain(ctx, { pr: n, ...(Object.keys(choices).length ? { choices: choices as Record<string, 'mine' | 'theirs'> } : {}), dryRun: has(a, 'dry-run') })) as Record<string, any>;
      return out(r, () => {
        io.print(said(r));
        for (const c of r.conflicts ?? []) io.print(`  ${c.key}  (${c.token}, default ${c.default ?? 'none: pick one'})`);
      });
    }
    case 'try': {
      const r = await branches.tryBranch(ctx, { pr: number(a, 2, 'bridge branch try <n>') });
      return out(r, () => {
        if (r.local) io.print(`Not online: try it locally with ${r.local.command}, then start Storybook or the app with its dev command.`);
        else for (const p of r.tryInProduct) io.print(`${p.name}: ${p.url ?? p.how}`);
        io.print(`\nShare with a product team: ${r.share.install ? r.share.install : r.share.sentence}`);
      });
    }
    case 'combine': {
      const prs = a._.slice(2);
      const picks = Object.fromEntries(Object.entries(pairs(a.flags.pick, 'pick')).map(([k, v]) => [k, branches.branchNumber(v)]));
      const r = (await branches.combineBranches(ctx, { prs, ...(Object.keys(picks).length ? { picks } : {}) })) as Record<string, any>;
      return out(r, () => {
        io.print(`${r.tokens} tokens change together.`);
        for (const c of r.conflicts) io.print(`  ${c.key}: pick one of ${c.options.map((o: { use: number }) => `#${o.use}`).join(', ')}${c.picked ? ` (picked #${c.picked})` : ''}`);
        for (const [k, v] of Object.entries(r.open)) io.print(`${k}: ${v}`);
        io.print(r.next);
      });
    }
    default:
      throw new RequestUsageError(`Unknown branch command "${sub}".\n\n${BRANCH_HELP}`);
  }
}

/** bridge products | settings | coverage [Component] | docs save. */
export async function runStudioRead(cmd: 'products' | 'settings' | 'coverage', a: RequestArgs, root: string, io: RequestIO = defaultIO()): Promise<number> {
  const ctx = await context(root, io, a, 'read');
  const json = has(a, 'json');
  if (cmd === 'products') {
    const r = await branches.listProducts(ctx);
    if (json) return io.print(JSON.stringify(r, null, 2)), 0;
    for (const p of r.products) io.print(`${p.key === r.current.key ? '*' : ' '} ${p.key.padEnd(12)} ${p.name}${p.default ? ' (default)' : ''}${p.path ? `  ${p.path}` : ''}${p.repo ? `  ${p.repo}` : ''}`);
    io.print(`\nThis folder: ${r.current.name}. Pick another with --product <key>.`);
    return 0;
  }
  if (cmd === 'settings') {
    const r = (await studio.getSettings(ctx)) as Record<string, any>;
    if (json) return io.print(JSON.stringify(r, null, 2)), 0;
    io.print(`Design approval: ${r.roles.designApproval.join(', ') || 'any reviewer'}`);
    io.print(`Tech approval: ${r.roles.techApproval.join(', ') || 'any reviewer'}`);
    if (r.roles.soloOwner) io.print(r.roles.soloOwner);
    io.print(`Merge: ${r.roles.ship}`);
    io.print(`Owner override: ${r.ownerOverride.on ? `${r.ownerOverride.who.join(', ')}. ${r.ownerOverride.reason}` : r.ownerOverride.reason}`);
    io.print(`Protection: ${r.protection}`);
    io.print(`Products: ${r.products.map((p: { name: string }) => p.name).join(', ')}`);
    return 0;
  }
  const r = (await studio.figmaCoverage(ctx, a._[1] ? { component: a._[1] } : {})) as Record<string, any>;
  if (json) return io.print(JSON.stringify(r, null, 2)), 0;
  io.print(r.summary);
  for (const c of r.components) io.print(`  ${c.name.padEnd(20)} ${c.inFigma}${c.why ? ` (${c.why})` : ''}`);
  if (r.fidelity) io.print(r.fidelity);
  return 0;
}

export async function runDocsSave(a: RequestArgs, root: string, io: RequestIO = defaultIO()): Promise<number> {
  const component = a._[2];
  const file = flag(a, 'file');
  if (!component || !file) throw new RequestUsageError('Usage: bridge docs save <Component> --file docs.json [--pr <n>] [--title "..."] [--jira DS-42] [--product admin] [--dry-run]');
  let docs: Record<string, unknown>;
  try {
    docs = JSON.parse(await readFile(resolve(root, file), 'utf8')) as Record<string, unknown>;
  } catch (e) {
    throw new RequestUsageError(`${file} is not a readable JSON file: ${(e as Error).message}. Pass the usage guidance as JSON, in the shape of the component's <Name>.docs.json.`);
  }
  const ctx = await context(root, io, a, has(a, 'dry-run') ? 'read' : 'write');
  const pr = flag(a, 'pr');
  const changes = changesFlag(a);
  const r = (await studio.saveDocs(ctx, {
    component,
    docs,
    ...(pr ? { pr } : {}),
    ...(flag(a, 'title') ? { title: flag(a, 'title') } : {}),
    ...(flag(a, 'notes') ? { notes: flag(a, 'notes') } : {}),
    ...(flag(a, 'jira') ? { jira: flag(a, 'jira') } : {}),
    ...(flag(a, 'product') ? { product: flag(a, 'product') } : {}),
    ...(changes ? { changes } : {}),
    source: 'cli',
    dryRun: has(a, 'dry-run'),
  })) as Record<string, unknown>;
  if (has(a, 'json')) io.print(JSON.stringify(r, null, 2));
  else io.print(r.status === 'dry-run' || r.status === 'preview' ? `${r.said ?? 'Dry run, nothing written.'}\n\n${r.path}:\n${r.content}` : `${String(r.said)}${r.next ? `\n${String(r.next)}` : ''}`);
  return 0;
}
