// Applying a suggestion (suggestions.ts) to the code a developer has now, not the commit it was planned on. The
// planner is pure logic over a small Workspace adapter (read a file, read it at the base commit, merge three texts), so
// the same steps run in Node on a git checkout (node/suggestion-apply-node.ts) and, later, in a browser against the
// GitHub API. Steps:
//   1. refuse what must never be read or written: unsafe paths (suggestionPathProblems), symlinks, a payload edited by
//      hand (unless the developer accepts it), a payload whose content does not match its recorded sha;
//   2. gate: the approvals on the current payload sha (summarizeSuggestionApprovals) must cover the tier;
//   3. classify every change against the current tree: already applied, apply, apply after a 3-way merge, conflict.
//      Token edits are re-applied with applyTokenEdits on the current tokens (never a text patch); files are compared
//      by git blob sha with the 3-way merge as fallback; docs are patched field by field;
//   4. re-run the checks on the result (validation, contrast, tier) and stop when the tier went up or a contrast pair
//      that passes today would fail;
//   5. say what to write. Nothing here writes: the adapter does, or the dry run shows the plan.
// Re-running on a tree that has the change is a no-op ("already applied" for every change).

import type { BridgeConfig } from './config';
import { docsFileText, validateDocs } from './docs-proposal';
import type { ComponentDocsJson } from './docs-draft';
import { LayeredTokenSet, selectTokenFiles, validateLayered, type LayerIssue } from './layered';
import { contrastDelta, diffLayered, runLayeredContrast, type ContrastDelta, type LayeredChange } from './layered-review';
import { pendingApprovals, type ApprovalRole } from './review-gate';
import { classifyRisk, type RiskResult, type RiskTier } from './risk';
import { composeSuggestionAppliedComment, summarizeSuggestionApprovals, suggestionReviewState, type SuggestionApprovals, type SuggestionCommentLike, type SuggestionGovernance } from './suggestion-review';
import { canonicalJson, gitBlobSha, suggestionIsTokenValues, suggestionPathProblems, type ParsedSuggestion, type SuggestionPayloadV1, type SuggestionTokenChange } from './suggestions';
import { applyTokenEdits, coerceValue, type TokenEdit } from './token-edits';
import { parseContrastChecks, type ContrastPair } from './wcag';

/** What the planner reads. Paths are repo-relative and already checked by suggestionPathProblems. */
export interface SuggestionWorkspace {
  /** The file as it is now (text and git blob sha), or null when it does not exist. */
  read(path: string): Promise<{ text: string; sha: string } | null>;
  /** The file at a commit (the payload's base sha), or null when it is missing there or the commit is unknown. */
  readAt(ref: string, path: string): Promise<string | null>;
  /** Every file path now, repo-relative (used to find the token files). */
  list(): Promise<string[]>;
  /** True when the path, or a folder on the way to it, is a symbolic link. Absent: no symlinks (a browser). */
  isSymlink?(path: string): Promise<boolean>;
  /** 3-way merge of a text file. Absent: a file changed on both sides is a conflict. */
  merge?(input: { path: string; ours: string; base: string; theirs: string }): Promise<{ clean: boolean; text: string; conflicts: number }>;
}

export type SuggestionApplyOpState = 'already-applied' | 'apply' | 'apply-merged' | 'conflict';

/** One change of the suggestion against the current tree. */
export interface SuggestionApplyOp {
  type: 'token' | 'file' | 'docs' | 'component-spec';
  /** Token path for token edits, repo path otherwise. */
  path: string;
  /** Token edits: the edit as suggested. */
  edit?: TokenEdit | undefined;
  /** Token file the edit targets, relative to tokens.root, when known. */
  file?: string | undefined;
  state: SuggestionApplyOpState;
  /** One sentence: what happens or why it conflicts. */
  detail: string;
  /** Conflicts: the value when suggested, the suggested value, and the value now. */
  before?: unknown;
  after?: unknown;
  now?: unknown;
  /** 3-way merge conflicts: how many conflict regions git found. */
  hunks?: number | undefined;
}

export type SuggestionApplyOutcome =
  /** The checks pass and every change can be written. */
  | 'ready'
  /** Every change is already in the tree: nothing to write. */
  | 'already-applied'
  /** At least one change conflicts with the current tree: nothing is written. */
  | 'conflict'
  /** The approvals on the current payload do not cover its tier. */
  | 'not-approved'
  /** The re-run checks stop it: the tier went up, a contrast pair would fail, or a new validation error. */
  | 'blocked'
  /** Not applied at all: unsafe path, symlink, edited payload, invalid content. */
  | 'refused';

/** Exit codes the CLI uses: 0 ok (ready or already applied), 1 gate or checks, 2 usage, 3 conflict. */
export const SUGGESTION_APPLY_EXIT: Record<SuggestionApplyOutcome, 0 | 1 | 3> = {
  ready: 0,
  'already-applied': 0,
  conflict: 3,
  'not-approved': 1,
  blocked: 1,
  refused: 1,
};

export interface SuggestionApplyGate {
  /** The payload's review state on its current sha. */
  review: 'needs-review' | 'changes-requested' | 'approved';
  /** Approvals still missing for the tier. */
  missing: ApprovalRole[];
  approvals: SuggestionApprovals;
  /** Applied without the approvals because the developer asked for it (recorded in the applied comment). */
  forced: boolean;
  /** The payload no longer matches what Bridge wrote; applied only because the developer accepted it. */
  edited: boolean;
}

export interface SuggestionApplyChecks {
  /** Tier when suggested and recomputed on the current tree. */
  tierWhenSuggested: RiskTier;
  tier: RiskResult;
  tierIncreased: boolean;
  /** Validation errors the result adds to today's tokens. */
  newErrors: LayerIssue[];
  /** Contrast pairs that pass today and would fail. */
  newFailures: ContrastDelta[];
  /** Every contrast pair that moved. */
  contrast: ContrastDelta[];
  /** Token changes the result makes against today's tokens. */
  tokenChanges: LayeredChange[];
}

export interface SuggestionApplyPlan {
  outcome: SuggestionApplyOutcome;
  exitCode: 0 | 1 | 3;
  /** One sentence for people: what happens, or what stops it and how to go on. */
  message: string;
  /** sha256 of the payload the plan applies (what approvals bound to). */
  payloadSha: string;
  payload: SuggestionPayloadV1;
  gate: SuggestionApplyGate | null;
  ops: SuggestionApplyOp[];
  /** Files to write when the outcome is "ready" (null content: delete). Empty otherwise. */
  writes: { path: string; content: string | null }[];
  checks: SuggestionApplyChecks | null;
  /** Why it is refused or blocked, as sentences. */
  problems: string[];
  /** Notes for the developer (token aliases left broken, a payload file the token edits replace...). */
  notes: string[];
  /** Component specs: the brief Claude or a developer implements from the spec file. */
  brief?: string | undefined;
}

export interface PlanSuggestionApplyInput {
  /** The parsed issue (parseSuggestionIssue). */
  parsed: Extract<ParsedSuggestion, { ok: true }>;
  /** bridge.config.json as read from the code (the default branch or the checkout), never from the payload. */
  config: BridgeConfig;
  /** Issue comments, for the approvals. */
  comments: readonly SuggestionCommentLike[];
  /** Owners and rights from the same config (plus team members when read). Default: the config's. */
  governance?: SuggestionGovernance | undefined;
  /** The issue author: never approves their own suggestion. */
  author?: string | null | undefined;
  workspace: SuggestionWorkspace;
  /** Apply even though the payload was edited by hand since Bridge wrote it. */
  acceptEdited?: boolean | undefined;
  /** Apply without every approval, or with a tier that went up (recorded in the applied comment). */
  forceUnapproved?: boolean | undefined;
}

const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const show = (v: unknown) => (v === undefined ? 'nothing' : typeof v === 'string' ? v : JSON.stringify(v));

function tokenRoot(config: BridgeConfig): string {
  const r = config.tokens.root.replace(/\/+$/, '');
  return r === '.' ? '' : r;
}

/** The token file (relative to tokens.root) a repo path is, or null when it is not one under this config. */
function tokenFileOf(config: BridgeConfig, path: string): string | null {
  const root = tokenRoot(config);
  if (root && !path.startsWith(`${root}/`)) return null;
  if (!selectTokenFiles(config, [path]).length) return null;
  return root ? path.slice(root.length + 1) : path;
}

/** Plans one token edit on `set`: its state, and the files after it when it applies. */
function planTokenEdit(set: LayeredTokenSet, e: TokenEdit, changes: readonly SuggestionTokenChange[]): { op: SuggestionApplyOp; files?: Map<string, string>; notes: string[] } {
  const base = { type: 'token' as const, path: e.path, edit: e, ...(e.file ? { file: e.file } : {}) };
  const defsAt = (path: string) => set.defs.filter((d) => d.path === path && (!e.file || d.file === e.file));
  const recorded = (file: string, path = e.path) => changes.find((c) => c.path === path && c.file === file && (e.op === 'rename' ? c.kind === 'renamed' : true));
  const conflict = (detail: string, extra: Partial<SuggestionApplyOp> = {}) => ({ op: { ...base, state: 'conflict' as const, detail, ...extra }, notes: [] });
  const done = (detail: string) => ({ op: { ...base, state: 'already-applied' as const, detail }, notes: [] });

  let result: ReturnType<typeof applyTokenEdits>;
  try {
    result = applyTokenEdits(set, [e]);
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    switch (e.op) {
      case 'rename': {
        const hasOld = defsAt(e.path).length > 0;
        const hasNew = set.defs.some((d) => d.path === e.newPath);
        if (!hasOld && hasNew) return done(`Already renamed to ${e.newPath}.`);
        return conflict(hasOld && hasNew ? `Both ${e.path} and ${e.newPath} exist now: rename it by hand.` : `${e.path} no longer exists: ${why}`);
      }
      case 'remove':
        if (!defsAt(e.path).length) return done('Already removed.');
        return conflict(why);
      case 'add': {
        const existing = defsAt(e.path);
        if (!existing.length) return conflict(why);
        const want = (file: string) => {
          const c = recorded(file);
          if (c && c.after !== undefined) return c.after;
          return coerceValue(e.value, e.type ?? existing.find((d) => d.file === file)?.type);
        };
        const all = existing.every((d) => same(d.value, want(d.file)));
        if (all) return done('Already added with the suggested value.');
        const d = existing.find((x) => !same(x.value, want(x.file)))!;
        return conflict(`Someone added ${e.path} with another value since.`, { file: d.file, after: want(d.file), now: d.value });
      }
      default:
        return conflict(defsAt(e.path).length ? why : `${e.path} no longer exists, so its value cannot be set.`);
    }
  }
  if (!result.touched.length) return done('Already has the suggested value.');

  // It changes something: check the value it replaces is still the one the suggestion saw.
  if (e.op === 'set' || e.op === 'remove' || e.op === 'rename') {
    for (const d of defsAt(e.path)) {
      const c = recorded(d.file, e.op === 'rename' ? (e.newPath ?? e.path) : e.path);
      if (!c) continue;
      const okNow = same(d.value, c.before) || (e.op === 'set' && same(d.value, c.after));
      if (!okNow) return conflict(`${e.path} changed since it was suggested (now ${show(d.value)}, suggested from ${show(c.before)}).`, { file: d.file, before: c.before, after: c.after, now: d.value });
    }
  }
  const verb = e.op === 'set' ? 'Set' : e.op === 'add' ? 'Add' : e.op === 'remove' ? 'Remove' : `Rename to ${e.newPath ?? ''}`;
  return { op: { ...base, state: 'apply', detail: `${verb} in ${result.touched.join(', ')}.` }, files: result.files, notes: result.notes };
}

/** One whole-file change against the current tree: by blob sha, with the 3-way merge when both sides moved. */
async function planFile(ws: SuggestionWorkspace, baseSha: string, f: NonNullable<SuggestionPayloadV1['files']>[number]): Promise<{ op: SuggestionApplyOp; content?: string | null | undefined }> {
  const base = { type: 'file' as const, path: f.path };
  const cur = await ws.read(f.path);
  const curSha = cur?.sha ?? null;
  const theirs = f.afterSha === null ? null : (f.content ?? null);
  if (curSha === f.afterSha) return { op: { ...base, state: 'already-applied', detail: f.afterSha === null ? 'Already deleted.' : 'Already has the suggested content.' } };
  if (curSha === f.beforeSha) return { op: { ...base, state: 'apply', detail: f.afterSha === null ? 'Delete it.' : f.beforeSha === null ? 'Create it.' : 'Replace it with the suggested content.' }, content: theirs };
  if (f.beforeSha === null) return { op: { ...base, state: 'conflict', detail: 'The suggestion creates this file, but a different one exists now.' } };
  if (!cur) return { op: { ...base, state: 'conflict', detail: 'The suggestion changes this file, but it was deleted since.' } };
  if (theirs === null) return { op: { ...base, state: 'conflict', detail: 'The suggestion deletes this file, but it changed since.' } };
  const original = await ws.readAt(baseSha, f.path);
  if (original === null || gitBlobSha(original) !== f.beforeSha || !ws.merge) {
    return { op: { ...base, state: 'conflict', detail: original === null ? 'The file changed since and its version at the suggestion base cannot be read, so it cannot be merged.' : 'The file changed since and cannot be merged here.' } };
  }
  const merged = await ws.merge({ path: f.path, ours: cur.text, base: original, theirs });
  if (!merged.clean) return { op: { ...base, state: 'conflict', detail: `The file changed since and the merge has ${merged.conflicts} conflict(s).`, hunks: merged.conflicts } };
  if (merged.text === cur.text) return { op: { ...base, state: 'already-applied', detail: 'Already has the suggested lines.' } };
  return { op: { ...base, state: 'apply-merged', detail: 'The file changed since: merged with the suggested lines, no conflict.' }, content: merged.text };
}

/**
 * The plan to apply a suggestion to the current tree. Never writes; the adapter writes `writes` when the outcome is
 * "ready". Stops before reading any file when a path is unsafe.
 */
export async function planSuggestionApply(input: PlanSuggestionApplyInput): Promise<SuggestionApplyPlan> {
  const { parsed, config, workspace: ws } = input;
  const payload = parsed.payload;
  const notes: string[] = [];
  const out = (outcome: SuggestionApplyOutcome, message: string, rest: Partial<SuggestionApplyPlan> = {}): SuggestionApplyPlan => ({
    outcome,
    exitCode: SUGGESTION_APPLY_EXIT[outcome],
    message,
    payloadSha: parsed.sha,
    payload,
    gate: null,
    ops: [],
    writes: [],
    checks: null,
    problems: [],
    notes,
    ...(payload.componentSpec ? { brief: payload.componentSpec.brief } : {}),
    ...rest,
  });

  // 1. What must never be read or written.
  const problems = suggestionPathProblems(payload, config);
  if (payload.checks.blocked) problems.push(`It was suggested with a failing check (${payload.checks.blocked}): ask the author to fix it and send it again.`);
  for (const f of payload.files ?? []) {
    if (f.afterSha !== null && typeof f.content !== 'string') problems.push(`"${f.path}" has no content in the suggestion: it is incomplete, ask the author to send it again.`);
    else if (f.afterSha !== null && gitBlobSha(f.content as string) !== f.afterSha) problems.push(`"${f.path}" does not match the content it was suggested with: someone edited it by hand.`);
  }
  if (problems.length) return out('refused', 'Not applied: the suggestion asks for something Bridge never writes.', { problems: [...new Set(problems)] });
  if (parsed.edited && !input.acceptEdited) {
    return out('refused', 'Not applied: the suggestion was edited by hand since Bridge wrote it. Read the change, then apply it with "accept edited" if it is right.', {
      problems: ['The payload no longer matches the sha Bridge recorded.'],
    });
  }
  const root = tokenRoot(config);
  const tokenFiles = selectTokenFiles(config, await ws.list());
  const targets = [
    ...(payload.files ?? []).map((f) => f.path),
    ...(payload.docs ?? []).map((d) => d.path),
    ...(payload.componentSpec ? [payload.componentSpec.specPath] : []),
    ...(payload.tokens?.edits.length ? tokenFiles.map((f) => (root ? `${root}/${f}` : f)) : []),
  ];
  if (ws.isSymlink) {
    const links: string[] = [];
    for (const p of new Set(targets)) if (await ws.isSymlink(p)) links.push(`"${p}" is a symbolic link (or inside one): Bridge never writes through links.`);
    if (links.length) return out('refused', 'Not applied: the suggestion writes through a symbolic link.', { problems: links });
  }

  // 2. Gate: approvals by owners on the current payload sha.
  const governance = input.governance ?? { owners: config.governance.owners, rights: config.governance.rights ?? null, soloOwnerCanApproveBoth: config.governance.soloOwnerCanApproveBoth };
  const approvals = summarizeSuggestionApprovals(input.comments, governance, { payloadSha: parsed.sha, author: input.author, valuesOnly: suggestionIsTokenValues(payload) });
  const review = suggestionReviewState(payload.tier.tier, approvals);
  const missing = pendingApprovals(payload.tier.tier, approvals);
  const approved = review === 'approved';
  const gate: SuggestionApplyGate = { review, missing, approvals, forced: !approved && Boolean(input.forceUnapproved), edited: parsed.edited };

  // 3. Classify every change against the current tree.
  const ops: SuggestionApplyOp[] = [];
  const writes = new Map<string, string | null>();
  const current = new Map<string, string>();
  for (const f of tokenFiles) {
    const r = await ws.read(root ? `${root}/${f}` : f);
    if (r) current.set(f, r.text);
  }
  const before = new LayeredTokenSet(config, current);
  let set = before;
  const appliedEdits: TokenEdit[] = [];
  for (const e of payload.tokens?.edits ?? []) {
    const r = planTokenEdit(set, e, payload.tokens!.changes);
    ops.push(r.op);
    notes.push(...r.notes);
    if (r.op.state === 'apply' && r.files) {
      set = new LayeredTokenSet(config, r.files);
      appliedEdits.push(e);
    }
  }
  for (const [f, text] of set.files) if (text !== before.files.get(f)) writes.set(set.repoPath(f), text);

  for (const f of payload.files ?? []) {
    if (writes.has(f.path)) {
      notes.push(`${f.path}: the token edits write this file, its copy in the suggestion is not used.`);
      continue;
    }
    const r = await planFile(ws, payload.base.sha, f);
    ops.push(r.op);
    if (r.op.state === 'apply' || r.op.state === 'apply-merged') writes.set(f.path, r.content ?? null);
  }

  for (const d of payload.docs ?? []) {
    const base = { type: 'docs' as const, path: d.path };
    const docs = d.after as ComponentDocsJson;
    let text: string;
    try {
      const issues = validateDocs(docs);
      if (issues.length) {
        problems.push(`${d.path}: ${issues.map((i) => i.message).join(' ')}`);
        continue;
      }
      const cur = await ws.read(d.path);
      text = docsFileText(docs, cur?.text ?? null);
      if (cur && text === cur.text) {
        ops.push({ ...base, state: 'already-applied', detail: 'The docs already say this.' });
        continue;
      }
      ops.push({ ...base, state: 'apply', detail: cur ? 'Update the changed fields; other fields stay as they are now.' : 'Create the docs file.' });
      writes.set(d.path, text);
    } catch (err) {
      problems.push(`${d.path}: the suggested docs are not a docs.json Bridge can read (${err instanceof Error ? err.message : String(err)}).`);
    }
  }

  if (payload.componentSpec) {
    const s = payload.componentSpec;
    const text = `${JSON.stringify(s.spec, null, 2)}\n`;
    const cur = await ws.read(s.specPath);
    if (cur && cur.text === text) ops.push({ type: 'component-spec', path: s.specPath, state: 'already-applied', detail: 'The spec file is already there.' });
    else {
      ops.push({ type: 'component-spec', path: s.specPath, state: 'apply', detail: `Write the spec; the ${s.component} code itself is written from the brief.` });
      writes.set(s.specPath, text);
    }
  }

  // 4. Checks on the result, against today's tree.
  const afterFiles = new Map(set.files);
  for (const [p, content] of writes) {
    const tf = tokenFileOf(config, p);
    if (!tf) continue;
    if (content === null) afterFiles.delete(tf);
    else afterFiles.set(tf, content);
  }
  const after = new LayeredTokenSet(config, afterFiles);
  const tokenChanges = diffLayered(before, after);
  const issueKey = (i: LayerIssue) => `${i.code}|${i.path ?? ''}|${i.file ?? ''}|${i.message}`;
  const prevErrors = new Set(validateLayered(before).map(issueKey));
  const newErrors = tokenChanges.length ? validateLayered(after).filter((i) => i.level === 'error' && !prevErrors.has(issueKey(i))) : [];
  let pairs: ContrastPair[] = [];
  if (config.contrast && tokenChanges.length) {
    try {
      pairs = parseContrastChecks((await ws.read(config.contrast.path))?.text);
    } catch {
      notes.push(`${config.contrast.path} does not parse: contrast was not checked.`);
    }
  }
  const modes = config.contrast?.modes;
  const contrast = pairs.length ? contrastDelta(runLayeredContrast(before, pairs, modes), runLayeredContrast(after, pairs, modes)) : [];
  const newFailures = contrast.filter((d) => d.passBefore && !d.passAfter);
  const otherFiles = [...writes.keys()].filter((p) => !tokenFileOf(config, p));
  const tier = classifyRisk({ tokenChanges: tokenChanges.map((c) => ({ kind: c.kind, path: c.path, ...(c.kind === 'changed' ? { descriptionOnly: c.fields.length > 0 && c.fields.every((x) => x === 'description') } : {}) })), files: otherFiles.map((path) => ({ path })), config });
  const tierIncreased = writes.size > 0 && tier.tier > payload.tier.tier;
  const checks: SuggestionApplyChecks = { tierWhenSuggested: payload.tier.tier, tier, tierIncreased, newErrors, newFailures, contrast, tokenChanges };
  const rest = { gate, ops, checks, problems };

  // 5. Outcome.
  if (problems.length) return out('refused', 'Not applied: part of the suggestion is not valid.', rest);
  const conflicts = ops.filter((o) => o.state === 'conflict');
  if (conflicts.length) {
    return out('conflict', `Not applied: ${conflicts.length} change(s) conflict with the code now. Ask the author to refresh the suggestion on today's code, or apply those parts by hand.`, rest);
  }
  if (!writes.size) return out('already-applied', 'Already applied: the code has every change of this suggestion.', rest);
  if (newErrors.length || newFailures.length) {
    const why = [newErrors.length ? `${newErrors.length} new validation error(s)` : '', newFailures.length ? `${newFailures.length} contrast pair(s) would fail` : ''].filter(Boolean).join(' and ');
    return out('blocked', `Not applied: on today's code it would add ${why}. Ask the author to refresh the suggestion.`, rest);
  }
  if (tierIncreased && !input.forceUnapproved) {
    return out('blocked', `Not applied: on today's code it is a tier ${tier.tier} change, it was approved as tier ${payload.tier.tier}. It needs a new approval.`, rest);
  }
  if (!approved && !input.forceUnapproved) {
    const who = review === 'changes-requested' ? `changes requested by ${approvals.changesRequested.map((l) => `@${l}`).join(', ')}` : `missing ${missing.map((m) => (m === 'approval' ? 'an approval' : `${m} approval`)).join(' and ')}`;
    return out('not-approved', `Not applied: it is not approved yet (${who}). Ask the owners to review it on the issue.`, rest);
  }
  const forced = gate.forced || (tierIncreased && Boolean(input.forceUnapproved));
  return out('ready', `Ready: ${writes.size} file(s) to write${forced ? ', without every approval' : ''}.`, {
    ...rest,
    gate: { ...gate, forced },
    writes: [...writes].map(([path, content]) => ({ path, content })).sort((a, b) => a.path.localeCompare(b.path)),
  });
}

/** The comment recording where a planned suggestion was applied (posting it is the caller's job). */
export function suggestionAppliedComment(plan: Pick<SuggestionApplyPlan, 'payloadSha' | 'gate'>, where: { by?: string | undefined; branch?: string | undefined; commit?: string | undefined; pr?: number | undefined; at: string }): string {
  return composeSuggestionAppliedComment({ ...where, payloadSha: plan.payloadSha, ...(plan.gate?.forced ? { forced: true } : {}) });
}

/** The per-change table of a plan, as Markdown (the CLI dry run, the MCP answer). */
export function suggestionApplyTable(plan: Pick<SuggestionApplyPlan, 'ops'>): string {
  const label: Record<SuggestionApplyOpState, string> = { 'already-applied': 'already applied', apply: 'apply', 'apply-merged': 'apply (merged)', conflict: '**conflict**' };
  const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  return ['| Change | Result | Detail |', '| --- | --- | --- |', ...plan.ops.map((o) => `| \`${cell(o.path)}\` | ${label[o.state]} | ${cell(o.detail)} |`)].join('\n');
}
