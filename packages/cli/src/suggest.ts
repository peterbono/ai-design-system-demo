// bridge suggestions, bridge apply, bridge review: suggestions from the terminal. A suggestion is a GitHub issue with an
// exact change (tokens, docs, a component spec, a brand, a revert, settings) that the owners approve and a developer
// applies with their own git and GitHub access. The same @bridge-ds/mcp operations Claude calls
// (bridge_list_suggestions, bridge_get_suggestion, bridge_review_suggestion, bridge_apply_suggestion).
import { SUGGESTION_APPLY_EXIT, SUGGESTION_STATUS_LABEL, type ChangesMode, type SuggestionStatus } from '@bridge-ds/core';
import { suggestions } from '@bridge-ds/mcp';
import { defaultIO, type RequestIO } from './request.js';
import { cliContext, TOKEN_HELP, type Access } from './auth.js';

export interface SuggestArgs {
  _: string[];
  flags: Record<string, string[]>;
}

export class SuggestUsageError extends Error {}

export const SUGGESTIONS_HELP = `bridge suggestions: changes filed as GitHub issues (label bridge-suggestion), applied by a developer

Usage:
  bridge suggestions [list] [--status needs-review|changes-requested|approved|applying|applied|declined|outdated|all]
                     [--kind token-change|docs|component-spec|brand|revert|config] [--json]
  bridge suggestions show <n> [--json]
                     the change, the checks, its version, who approved it and what is missing
  bridge suggestions link <n> --pr <m> | --branch <name>
                     record the pull request that applies it (it must say "Closes #<n>")
  bridge apply <n> [--write | --patch] [--dry-run] [--accept-edited] [--force-unapproved] [--branch name] [--json]
                     apply it on today's code: a new local branch by default (working tree untouched, nothing
                     pushed), --write into the working tree, --patch prints a patch for git am. --dry-run shows
                     the plan and the diff and writes nothing
  bridge review <n> --approve | --request-changes --message "..." | --decline --message "..." [--version <sha>]
                     as the owner your GitHub token belongs to; counts only for owners in bridge.config.json

${TOKEN_HELP}
Exit codes (apply): 0 applied, already applied or a clean dry run; 1 not approved, blocked by a check or refused;
2 usage or setup error; 3 conflict with today's code.`;

const flag = (a: SuggestArgs, k: string) => a.flags[k]?.[a.flags[k]!.length - 1];
const has = (a: SuggestArgs, k: string) => Boolean(a.flags[k]);

/** --suggest or --direct, for the commands that change the code; undefined: the config decides. */
export function changesFlag(a: SuggestArgs): ChangesMode | undefined {
  if (has(a, 'suggest') && has(a, 'direct')) throw new SuggestUsageError('Pass --suggest or --direct, not both.');
  return has(a, 'direct') ? 'direct' : has(a, 'suggest') ? 'suggest' : undefined;
}

const context = (root: string, io: RequestIO, a: SuggestArgs, access: Access) => cliContext(root, io, a, access);

function issueNumber(raw: string | undefined, usage: string): number {
  const n = Number((raw ?? '').replace(/^#/, ''));
  if (!raw || !Number.isInteger(n) || n <= 0) throw new SuggestUsageError(`Usage: ${usage}`);
  return n;
}

const STATUSES = ['needs-review', 'changes-requested', 'approved', 'applying', 'applied', 'declined', 'outdated', 'all'];
const KINDS = ['token-change', 'docs', 'component-spec', 'brand', 'revert', 'config'];

/** `bridge suggestions [list | show <n> | link <n>]`. */
export async function runSuggestions(a: SuggestArgs, root: string, io: RequestIO = defaultIO()): Promise<number> {
  const sub = a._[1] ?? 'list';
  if (sub === 'help' || has(a, 'help')) return io.print(SUGGESTIONS_HELP), 0;
  switch (sub) {
    case 'list': {
      const status = flag(a, 'status') ?? 'all';
      if (!STATUSES.includes(status)) throw new SuggestUsageError(`--status takes ${STATUSES.join(', ')}, got "${status}"`);
      const kind = flag(a, 'kind');
      if (kind && !KINDS.includes(kind)) throw new SuggestUsageError(`--kind takes ${KINDS.join(', ')}, got "${kind}"`);
      const ctx = await context(root, io, a, 'read');
      const r = await suggestions.listSuggestionsOp(ctx, { status: status as suggestions.SuggestionStatusFilter, ...(kind ? { kind: kind as never } : {}) });
      if (has(a, 'json')) return io.print(JSON.stringify(r, null, 2)), 0;
      if (!r.suggestions.length) return io.print(`No ${status === 'all' ? 'open ' : `${status} `}suggestion in ${r.repo}.`), 0;
      for (const x of r.suggestions) {
        const prs = x.linkedPrs.length ? `  PR ${x.linkedPrs.map((p) => `#${p.number}${p.merged ? ' merged' : ` ${p.state}`}`).join(', ')}` : '';
        io.print(`#${String(x.number).padEnd(5)} ${x.said.padEnd(25)} ${(x.kind ?? '').padEnd(14)} ${x.tier ? `tier ${x.tier}` : '      '}  ${x.title}${prs}`);
      }
      io.print(`\n${r.next}`);
      return 0;
    }
    case 'show': {
      const n = issueNumber(a._[2], 'bridge suggestions show <number>');
      const ctx = await context(root, io, a, 'read');
      const r = (await suggestions.getSuggestionOp(ctx, { number: n })) as Record<string, any>;
      if (has(a, 'json')) return io.print(JSON.stringify(r, null, 2)), 0;
      io.print(`#${r.number} ${r.title}`);
      io.print(`${r.said}${r.kind ? `, ${r.kind}` : ''}${r.tier ? `, tier ${r.tier} (${r.bump})` : ''}${r.source ? `, from ${r.source}` : ''}${r.suggestedBy ? ` by @${r.suggestedBy}` : ''}`);
      io.print(r.url);
      if (r.problem) {
        io.print(`\n${r.problem}`);
        return 1;
      }
      if (r.summary) io.print(`\n${r.summary}`);
      const c = r.change ?? {};
      if (c.tokens?.length) {
        io.print('\nTokens:');
        for (const t of c.tokens) io.print(`  ${t.kind ?? t.op} ${t.path}${t.before !== undefined || t.after !== undefined ? `: ${fmt(t.before)} -> ${fmt(t.after)}` : ''}`);
      }
      for (const d of c.docs ?? []) io.print(`Docs: ${d.component} (${d.path})`);
      if (c.componentSpec) io.print(`Component spec: ${c.componentSpec.component} (${c.componentSpec.specPath})`);
      for (const f of c.files ?? []) io.print(`File: ${f.change} ${f.path}`);
      io.print(`\nVersion ${r.version}${r.edited ? ` (${r.edited})` : ''}`);
      io.print(`Approved by: ${r.approvals.approvedBy.map((l: string) => `@${l}`).join(', ') || 'nobody yet'}`);
      if (r.approvals.missing.length) io.print(`Missing: ${r.approvals.missing.join(' and ')}`);
      if (r.approvals.soloOwner) io.print(r.approvals.soloOwner);
      if (r.approvals.changesRequestedBy.length) io.print(`Changes requested by: ${r.approvals.changesRequestedBy.map((l: string) => `@${l}`).join(', ')}`);
      for (const p of r.linkedPrs ?? []) io.print(`Pull request: #${p.number} ${p.merged ? 'merged' : p.state}  ${p.url}`);
      io.print(`\nNext: ${r.next}`);
      return 0;
    }
    case 'link': {
      const n = issueNumber(a._[2], 'bridge suggestions link <number> --pr <m>');
      const prRaw = flag(a, 'pr');
      const pr = prRaw ? issueNumber(prRaw, 'bridge suggestions link <number> --pr <m>') : undefined;
      const branch = flag(a, 'branch');
      if (!pr && !branch) throw new SuggestUsageError('Usage: bridge suggestions link <number> --pr <m> (or --branch <name>)');
      const ctx = await context(root, io, a, 'write');
      const r = await suggestions.linkSuggestionOp(ctx, { number: n, ...(pr ? { pr } : {}), ...(branch ? { branch } : {}) });
      if (has(a, 'json')) return io.print(JSON.stringify(r, null, 2)), 0;
      io.print(`#${n} is being applied${pr ? ` in #${pr}` : branch ? ` on ${branch}` : ''}.`);
      for (const w of r.warnings ?? []) io.error(`warning: ${w}`);
      return 0;
    }
    default:
      throw new SuggestUsageError(`Unknown suggestions command "${sub}".\n\n${SUGGESTIONS_HELP}`);
  }
}

const fmt = (v: unknown) => (v === undefined ? '(none)' : typeof v === 'string' ? v : JSON.stringify(v));

/** `bridge apply <n>`: exit code from SUGGESTION_APPLY_EXIT (0 ok, 1 gate or checks, 3 conflict), 2 for usage. */
export async function runApply(a: SuggestArgs, root: string, io: RequestIO = defaultIO()): Promise<number> {
  if (has(a, 'help') || a._[1] === 'help') return io.print(SUGGESTIONS_HELP), 0;
  const n = issueNumber(a._[1], 'bridge apply <number> [--write | --patch] [--dry-run]');
  if (has(a, 'write') && has(a, 'patch')) throw new SuggestUsageError('Pass --write or --patch, not both.');
  const mode = has(a, 'write') ? 'write' : has(a, 'patch') ? 'patch' : 'branch';
  // Applying writes locally; with a token it also says so on the issue (a comment and a label).
  const ctx = await context(root, io, a, has(a, 'dry-run') ? 'read' : 'write');
  if (ctx.mode !== 'local' || !ctx.isGit) throw new SuggestUsageError('bridge apply runs in a git checkout of the design system: cd into it, or pass --root.');
  const branch = flag(a, 'branch');
  const r = (await suggestions.applySuggestionOp(ctx, {
    number: n,
    mode: has(a, 'dry-run') ? 'dry-run' : mode,
    acceptEdited: has(a, 'accept-edited'),
    forceUnapproved: has(a, 'force-unapproved'),
    ...(branch ? { branch } : {}),
  })) as Record<string, any>;
  const code: number = typeof r.exitCode === 'number' ? r.exitCode : (SUGGESTION_APPLY_EXIT[r.outcome as keyof typeof SUGGESTION_APPLY_EXIT] ?? 1);
  if (has(a, 'json')) return io.print(JSON.stringify(r, null, 2)), code;
  if (mode === 'patch' && r.patch && !has(a, 'dry-run')) {
    // The patch alone on stdout so `bridge apply 42 --patch | git am` works; the rest on stderr.
    io.print(r.patch.trimEnd());
    io.error(r.message);
    for (const w of r.warnings ?? []) io.error(`warning: ${w}`);
    return code;
  }
  io.print(`#${n}: ${r.message}`);
  if (r.table) io.print(`\n${r.table}`);
  for (const p of r.problems ?? []) io.print(`  ${p}`);
  for (const note of r.notes ?? []) io.print(`  note: ${note}`);
  if (r.diff) io.print(`\n${r.diff.trimEnd()}`);
  if (r.brief) io.print(`\nBrief to implement it:\n${r.brief}`);
  if (r.branch) io.print(`\nbranch: ${r.branch}${r.commit ? ` (${String(r.commit).slice(0, 7)})` : ''}`);
  for (const w of r.warnings ?? []) io.error(`warning: ${w}`);
  if (r.next && r.next !== r.message) io.print(`\nNext: ${r.next}`);
  return code;
}

/** `bridge review <n> --approve | --request-changes | --decline`. */
export async function runReview(a: SuggestArgs, root: string, io: RequestIO = defaultIO()): Promise<number> {
  if (has(a, 'help') || a._[1] === 'help') return io.print(SUGGESTIONS_HELP), 0;
  const usage = 'bridge review <number> --approve | --request-changes --message "..." | --decline --message "..."';
  const n = issueNumber(a._[1], usage);
  const events = (['approve', 'request-changes', 'decline', 'comment'] as const).filter((e) => has(a, e));
  if (events.length !== 1) throw new SuggestUsageError(`Usage: ${usage}`);
  const event = events[0]!;
  // `--request-changes "text"` works too, like `bridge branch review`.
  const inline = flag(a, event);
  const message = flag(a, 'message') ?? (inline && inline !== 'true' ? inline : undefined);
  if ((event === 'request-changes' || event === 'decline' || event === 'comment') && !message?.trim()) throw new SuggestUsageError(`--${event} needs --message "..." (the author reads it).`);
  const role = flag(a, 'role');
  if (role && !['design', 'tech', 'approval'].includes(role)) throw new SuggestUsageError(`--role takes design, tech or approval, got "${role}"`);
  const ctx = await context(root, io, a, 'write');
  const version = flag(a, 'version');
  const r = (await suggestions.reviewSuggestionOp(ctx, {
    number: n,
    event,
    ...(message ? { message } : {}),
    ...(role ? { role: role as 'design' | 'tech' | 'approval' } : {}),
    ...(version ? { payloadSha: version } : {}),
  })) as Record<string, any>;
  if (has(a, 'json')) return io.print(JSON.stringify(r, null, 2)), 0;
  const done = event === 'approve' ? 'Approved' : event === 'request-changes' ? 'Changes requested on' : event === 'decline' ? 'Declined' : 'Commented on';
  io.print(`${done} #${n}${r.version ? ` (version ${r.version})` : ''}. Now: ${SUGGESTION_STATUS_LABEL[r.status as SuggestionStatus] ?? r.status}.`);
  for (const w of r.warnings ?? []) io.error(`warning: ${w}`);
  if (r.next) io.print(`Next: ${r.next}`);
  return r.counts === false ? 1 : 0;
}
