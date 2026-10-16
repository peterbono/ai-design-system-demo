// History and rollback for a token set: what changed, when, who changed it and why, and how to undo a
// change safely. Pure: the commits and file snapshots come from a backend (GitHub REST in
// history-github.ts, local git in @bridge/core/node), so the same model runs in a browser, the CLI and the
// MCP server.
//
// A revert is not a blind `git revert`. The planner computes the inverse token edits against the CURRENT
// base branch: a token that changed again after the original change is a conflict, shown with the later
// change, and kept as it is unless the caller asks to restore the old value anyway. What remains goes
// through the same minimal-diff edits, validation, contrast gate, risk tier and changeset as any proposal.

import type { BridgeConfig } from './config';
import { type Combo, type LayerIssue, LayeredTokenSet, globToRegExp, validateLayered } from './layered';
import { type ChangeTier, type ContrastDelta, type LayeredChange, classifyLayered, composeProposalBody, contrastDelta, diffLayered, layeredImpact, runLayeredContrast } from './layered-review';
import { type TokenEdit, applyTokenEdits } from './token-edits';
import { formatChangeset } from './changeset';
import { slugify } from './pr-composer';
import type { SemverBump } from './risk';
import type { ContrastPair } from './wcag';

// --- model ------------------------------------------------------------------------------------------------

export interface HistoryPullRequest {
  number: number;
  title: string;
  url?: string;
  author?: string;
  mergedAt?: string;
  body?: string;
}

/** A commit that touched the token files, newest first in lists. */
export interface HistoryCommit {
  sha: string;
  parents: string[];
  /** ISO date. */
  date: string;
  author: string;
  subject: string;
  body?: string;
  pr?: HistoryPullRequest;
}

export interface HistoryChangeset {
  path: string;
  bump?: SemverBump;
  packages: string[];
  summary: string;
}

export interface HistoryCounts {
  added: number;
  changed: number;
  removed: number;
  renamed: number;
  total: number;
}

/** One merged change to the tokens: a pull request, or a commit that landed without one. */
export interface HistoryEntry {
  /** `pr-12` for a pull request, the short sha otherwise. */
  id: string;
  /** Commit that landed the change on the base branch. */
  sha: string;
  /** Commit the diff is computed from (first parent). */
  baseSha?: string;
  date: string;
  author: string;
  title: string;
  /** Why: the changeset summary, else the PR description, else the commit body, else the title. */
  why: string;
  pr?: HistoryPullRequest;
  changes: LayeredChange[];
  counts: HistoryCounts;
  tier: 1 | 2 | 3;
  bump: SemverBump;
  breaking: boolean;
  reasons: string[];
  changesets: HistoryChangeset[];
  /** Release the change shipped in, or "Unreleased" (set by assignVersions). */
  version?: string;
  /** More than BULK_LIMIT token changes: an import or a restructure, not a reviewable edit. */
  bulk?: boolean;
  /** Fixture data for demos and tests. Never mixed with real history. */
  demo?: boolean;
}

export const BULK_LIMIT = 60;
export const UNRELEASED = 'Unreleased';

const SUBJECT_PR = [/^Merge pull request #(\d+)/, /\(#(\d+)\)\s*$/];

/** PR number from a merge or squash subject ("Merge pull request #12 from ...", "Fix x (#12)"). */
export function prNumberFromSubject(subject: string): number | undefined {
  for (const re of SUBJECT_PR) {
    const m = re.exec(subject);
    if (m) return Number(m[1]);
  }
  return undefined;
}

/** Frontmatter bumps and summary of a .changeset/*.md file. */
export function parseChangesetText(path: string, text: string): HistoryChangeset | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return null;
  const bumps = [...m[1]!.matchAll(/["']?([^"'\s:]+)["']?\s*:\s*(major|minor|patch)/g)].map((x) => ({ pkg: x[1]!, bump: x[2] as SemverBump }));
  const order: SemverBump[] = ['major', 'minor', 'patch'];
  const bump = order.find((b) => bumps.some((x) => x.bump === b));
  const summary = m[2]!.trim().split(/\r?\n\r?\n/)[0]!.replace(/\s+/g, ' ').trim();
  return { path, ...(bump ? { bump } : {}), packages: bumps.map((b) => b.pkg), summary };
}

/** First paragraph of a PR body or commit body, without template headings, checklists or HTML comments. */
export function firstParagraph(text: string | undefined): string {
  if (!text) return '';
  const cleaned = text.replace(/<!--[\s\S]*?-->/g, '');
  for (const para of cleaned.split(/\r?\n\s*\r?\n/)) {
    const lines = para.split(/\r?\n/).filter((l) => l.trim() && !/^\s*#{1,6}\s/.test(l) && !/^\s*[-*]\s*\[[ xX]\]/.test(l) && !/^\s*(Co-Authored-By|Claude-Session|Signed-off-by):/i.test(l));
    const s = lines.join(' ').replace(/\s+/g, ' ').trim();
    if (s && !/^\|/.test(s)) return s.length > 400 ? `${s.slice(0, 397)}...` : s;
  }
  return '';
}

export function countChanges(changes: LayeredChange[]): HistoryCounts {
  const c: HistoryCounts = { added: 0, changed: 0, removed: 0, renamed: 0, total: changes.length };
  for (const x of changes) c[x.kind]++;
  return c;
}

const shortSha = (sha: string) => sha.slice(0, 7);

/** The title of a commit for people: the PR title, else the merged PR's first body line, else the subject. */
export function titleOf(commit: HistoryCommit): string {
  if (commit.pr?.title) return commit.pr.title;
  if (/^Merge pull request #\d+/.test(commit.subject)) {
    const first = (commit.body ?? '').split(/\r?\n/).find((l) => l.trim());
    if (first) return first.trim();
  }
  return commit.subject;
}

export interface EntryInput {
  config: BridgeConfig;
  commit: HistoryCommit;
  /** Token files (relative to tokens.root) before and after the change. */
  before: Map<string, string>;
  after: Map<string, string>;
  /** Changeset files the change added: { path, text }. */
  changesets?: { path: string; text: string }[];
  demo?: boolean;
}

/** A history entry from two snapshots, or null when no token changed (formatting, moves of whitespace). */
export function buildHistoryEntry(input: EntryInput): HistoryEntry | null {
  const { config, commit } = input;
  const beforeSet = new LayeredTokenSet(config, input.before);
  const afterSet = new LayeredTokenSet(config, input.after);
  const changes = diffLayered(beforeSet, afterSet);
  if (!changes.length) return null;
  const tier = classifyLayered(changes, [], config);
  const changesets = (input.changesets ?? []).map((c) => parseChangesetText(c.path, c.text)).filter((c): c is HistoryChangeset => c !== null);
  const pkg = config.changesets?.package;
  const relevant = changesets.filter((c) => !pkg || !c.packages.length || c.packages.includes(pkg));
  const title = titleOf(commit);
  const why = relevant.map((c) => c.summary).find(Boolean) || firstParagraph(commit.pr?.body) || firstParagraph(commit.body) || title;
  const prNumber = commit.pr?.number ?? prNumberFromSubject(commit.subject);
  const pr = commit.pr ?? (prNumber ? { number: prNumber, title, ...(config.repo ? { url: `https://github.com/${config.repo.owner}/${config.repo.name}/pull/${prNumber}` } : {}) } : undefined);
  const changesetBump = relevant.map((c) => c.bump).find((b) => b === 'major');
  const bump: SemverBump = changesetBump ?? tier.bump;
  return {
    id: pr ? `pr-${pr.number}` : shortSha(commit.sha),
    sha: commit.sha,
    ...(commit.parents[0] ? { baseSha: commit.parents[0] } : {}),
    date: commit.date,
    author: commit.pr?.author ?? commit.author,
    title,
    why,
    ...(pr ? { pr } : {}),
    changes,
    counts: countChanges(changes),
    tier: tier.tier,
    bump,
    breaking: bump === 'major',
    reasons: tier.reasons,
    changesets: relevant,
    ...(changes.length > BULK_LIMIT ? { bulk: true } : {}),
    ...(input.demo ? { demo: true } : {}),
  };
}

// --- backends ---------------------------------------------------------------------------------------------

/** Where commits and snapshots come from: GitHub REST, local git, or fixtures. */
export interface HistoryBackend {
  /** Commits on `ref` that touched `paths` (repo-relative), newest first, with their PR when known. */
  listCommits(opts: { ref: string; paths: string[]; limit: number }): Promise<HistoryCommit[]>;
  /** Token files (relative to tokens.root) at a commit. */
  tokenFiles(sha: string): Promise<Map<string, string>>;
  /** Repo-relative paths of changeset files at a commit (empty when the repo has none). */
  changesetPaths?(sha: string): Promise<string[]>;
  readFile?(sha: string, path: string): Promise<string | null>;
}

export interface CollectOptions {
  ref: string;
  /** Most recent commits to inspect (default 40). */
  limit?: number;
  onProgress?: (done: number, total: number) => void;
}

/**
 * History of the token files on `ref`, newest first. Commits of one pull request fold into one entry when the
 * backend knows the PR (GitHub lists branch commits too); the entry diffs the first parent of the newest
 * commit of the group against that commit, which for a merge or squash commit is the whole PR.
 */
export async function collectHistory(config: BridgeConfig, backend: HistoryBackend, opts: CollectOptions): Promise<HistoryEntry[]> {
  const root = config.tokens.root.replace(/\/$/, '');
  const commits = await backend.listCommits({ ref: opts.ref, paths: [root === '.' ? '' : root].filter(Boolean), limit: opts.limit ?? 40 });
  // Group by PR: keep the newest commit of each PR (the merge or squash commit when it is on the list).
  const seen = new Set<number>();
  const picked: HistoryCommit[] = [];
  for (const c of commits) {
    const n = c.pr?.number;
    if (n !== undefined) {
      if (seen.has(n)) continue;
      seen.add(n);
    }
    picked.push(c);
  }
  const entries: HistoryEntry[] = [];
  let done = 0;
  for (const c of picked) {
    const parent = c.parents[0];
    const [before, after] = await Promise.all([parent ? backend.tokenFiles(parent) : Promise.resolve(new Map<string, string>()), backend.tokenFiles(c.sha)]);
    let changesets: { path: string; text: string }[] = [];
    if (backend.changesetPaths && backend.readFile && config.changesets) {
      const [was, now] = await Promise.all([parent ? backend.changesetPaths(parent) : Promise.resolve([]), backend.changesetPaths(c.sha)]);
      const added = now.filter((p) => !was.includes(p) && p.endsWith('.md') && !/README\.md$/i.test(p));
      changesets = (await Promise.all(added.map(async (p) => ({ path: p, text: (await backend.readFile!(c.sha, p)) ?? '' })))).filter((x) => x.text);
    }
    const e = buildHistoryEntry({ config, commit: c, before, after, changesets });
    if (e) entries.push(e);
    opts.onProgress?.(++done, picked.length);
  }
  return entries;
}

// --- versions ---------------------------------------------------------------------------------------------

export interface HistoryRelease {
  version: string;
  date?: string;
  /** Tag commit, when known. */
  sha?: string;
  /** Commits and PRs the CHANGELOG lists under this version. */
  shas?: string[];
  prs?: number[];
}

/** Releases from a Changesets CHANGELOG.md: `## 1.2.0` sections and the shas and PR numbers they cite. */
export function parseChangelog(text: string): HistoryRelease[] {
  const out: HistoryRelease[] = [];
  const parts = text.split(/^##\s+/m).slice(1);
  for (const p of parts) {
    const [head, ...rest] = p.split(/\r?\n/);
    const version = /v?(\d+\.\d+\.\d+(?:-[\w.]+)?)/.exec(head ?? '')?.[1];
    if (!version) continue;
    const body = rest.join('\n');
    const shas = [...new Set([...body.matchAll(/(?:^|[\s[`(])([0-9a-f]{7,40})(?=[\s`\]):]|$)/gm)].map((m) => m[1]!))];
    const prs = [...new Set([...body.matchAll(/(?:#|\/pull\/)(\d+)/g)].map((m) => Number(m[1])))];
    const date = /(\d{4}-\d{2}-\d{2})/.exec(head ?? '')?.[1];
    out.push({ version, ...(date ? { date } : {}), shas, prs });
  }
  return out;
}

/** Releases from git tags (`v1.2.0`, `@scope/pkg@1.2.0`); tags of other packages are ignored when `pkg` is given. */
export function releasesFromTags(tags: { name: string; sha?: string; date?: string }[], pkg?: string): HistoryRelease[] {
  const out: HistoryRelease[] = [];
  for (const t of tags) {
    const m = /^(?:(@?[^@\s]+)@)?v?(\d+\.\d+\.\d+(?:-[\w.]+)?)$/.exec(t.name);
    if (!m) continue;
    if (pkg && m[1] && m[1] !== pkg) continue;
    out.push({ version: m[2]!, ...(t.sha ? { sha: t.sha } : {}), ...(t.date ? { date: t.date } : {}) });
  }
  return out;
}

/**
 * Sets `version` on every entry: the release whose CHANGELOG section cites its sha or PR, else the first
 * tagged release dated at or after it, else "Unreleased". Returns new entries; the input is not changed.
 */
export function assignVersions(entries: HistoryEntry[], releases: HistoryRelease[]): HistoryEntry[] {
  const dated = releases.filter((r) => r.date).sort((a, b) => Date.parse(a.date!) - Date.parse(b.date!));
  return entries.map((e) => {
    const cited = releases.find((r) => r.shas?.some((s) => e.sha.startsWith(s)) || (e.pr && r.prs?.includes(e.pr.number)));
    const byTag = cited ? undefined : dated.find((r) => r.sha === e.sha || Date.parse(r.date!) >= Date.parse(e.date));
    return { ...e, version: (cited ?? byTag)?.version ?? UNRELEASED };
  });
}

export interface VersionGroup {
  version: string;
  pending: boolean;
  /** Release date, else the newest change in it. */
  date: string;
  entries: string[];
  prs: number[];
  tokenChanges: number;
  breaking: boolean;
  bump: SemverBump;
  authors: string[];
}

const BUMP_RANK: Record<SemverBump, number> = { patch: 0, minor: 1, major: 2 };

/** The timeline of design system versions, newest first ("Unreleased" on top). */
export function versionTimeline(entries: HistoryEntry[], releases: HistoryRelease[] = []): VersionGroup[] {
  const groups = new Map<string, VersionGroup>();
  for (const e of entries) {
    const v = e.version ?? UNRELEASED;
    let g = groups.get(v);
    if (!g) {
      const rel = releases.find((r) => r.version === v);
      g = { version: v, pending: v === UNRELEASED, date: rel?.date ?? e.date, entries: [], prs: [], tokenChanges: 0, breaking: false, bump: 'patch', authors: [] };
      groups.set(v, g);
    }
    g.entries.push(e.id);
    if (e.pr && !g.prs.includes(e.pr.number)) g.prs.push(e.pr.number);
    g.tokenChanges += e.counts.total;
    g.breaking ||= e.breaking;
    if (BUMP_RANK[e.bump] > BUMP_RANK[g.bump]) g.bump = e.bump;
    if (!g.authors.includes(e.author)) g.authors.push(e.author);
    if (!releases.some((r) => r.version === v && r.date) && Date.parse(e.date) > Date.parse(g.date)) g.date = e.date;
  }
  return [...groups.values()].sort((a, b) => (a.pending ? -1 : b.pending ? 1 : Date.parse(b.date) - Date.parse(a.date)));
}

// --- filters and per-token history ------------------------------------------------------------------------

export interface HistoryFilter {
  /** Token path or group prefix: color.text matches color.text.muted. */
  token?: string;
  author?: string;
  tier?: 1 | 2 | 3;
  version?: string;
  breaking?: boolean;
  /** ISO dates, inclusive. */
  since?: string;
  until?: string;
  /** Free text over title, why and PR number. */
  query?: string;
}

const matchesToken = (path: string, q: string) => path === q || path.startsWith(`${q.replace(/\.$/, '')}.`);

export function filterHistory(entries: HistoryEntry[], f: HistoryFilter = {}): HistoryEntry[] {
  const q = f.query?.trim().toLowerCase();
  return entries.filter(
    (e) =>
      (!f.token || e.changes.some((c) => matchesToken(c.path, f.token!) || (c.from && matchesToken(c.from, f.token!)))) &&
      (!f.author || e.author.toLowerCase() === f.author.toLowerCase()) &&
      (!f.tier || e.tier === f.tier) &&
      (!f.version || (e.version ?? UNRELEASED) === f.version) &&
      (f.breaking === undefined || e.breaking === f.breaking) &&
      (!f.since || Date.parse(e.date) >= Date.parse(f.since)) &&
      (!f.until || Date.parse(e.date) <= Date.parse(f.until) + 86_399_999) &&
      (!q || `${e.title} ${e.why} ${e.pr ? `#${e.pr.number}` : ''} ${e.sha}`.toLowerCase().includes(q)),
  );
}

/** Mode values a token file stands for, from the layer that matches it: semantic/dark.tokens.json -> { theme: "dark" }. */
export function fileModes(config: BridgeConfig, file: string): Partial<Combo> {
  for (const layer of config.tokens.layers) {
    const keys: string[] = [];
    const marked = layer.files.replace(/\{([^}]+)\}/g, (_, k: string) => {
      keys.push(k);
      return '\u0001';
    });
    const source = globToRegExp(marked).source.replace(/\u0001/g, '([^/.]+)');
    const m = new RegExp(source).exec(file);
    if (m) return Object.fromEntries(keys.map((k, i) => [k, m[i + 1]!]));
  }
  return {};
}

/** "Dark", "Ocean dark", or "All modes". */
export function modeLabel(modes: Partial<Combo>): string {
  const v = Object.values(modes).filter(Boolean) as string[];
  if (!v.length) return 'All modes';
  const s = v.join(' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export interface TokenHistoryItem {
  entryId: string;
  sha: string;
  date: string;
  author: string;
  title: string;
  why: string;
  pr?: HistoryPullRequest;
  version?: string;
  demo?: boolean;
  kind: LayeredChange['kind'];
  /** Path at the time of the change (a rename shows the old path in `from`). */
  path: string;
  from?: string;
  file: string;
  modes: Partial<Combo>;
  modeLabel: string;
  fields: LayeredChange['fields'];
  before?: unknown;
  after?: unknown;
  beforeCss?: string;
  afterCss?: string;
  descriptionBefore?: string;
  descriptionAfter?: string;
}

/** Every change of one token, newest first, following renames back to older names. */
export function tokenHistory(entries: HistoryEntry[], path: string, config?: BridgeConfig): TokenHistoryItem[] {
  const names = new Set([path]);
  const out: TokenHistoryItem[] = [];
  const sorted = [...entries].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  for (const e of sorted) {
    const hits = e.changes.filter((c) => names.has(c.path));
    for (const c of hits) {
      const modes = config ? fileModes(config, c.file) : {};
      out.push({
        entryId: e.id,
        sha: e.sha,
        date: e.date,
        author: e.author,
        title: e.title,
        why: e.why,
        ...(e.pr ? { pr: e.pr } : {}),
        ...(e.version ? { version: e.version } : {}),
        ...(e.demo ? { demo: true } : {}),
        kind: c.kind,
        path: c.path,
        ...(c.from ? { from: c.from } : {}),
        file: c.file,
        modes,
        modeLabel: modeLabel(modes),
        fields: c.fields,
        ...(c.before !== undefined ? { before: c.before } : {}),
        ...(c.after !== undefined ? { after: c.after } : {}),
        ...(c.beforeCss !== undefined ? { beforeCss: c.beforeCss } : {}),
        ...(c.afterCss !== undefined ? { afterCss: c.afterCss } : {}),
        ...(c.descriptionBefore !== undefined ? { descriptionBefore: c.descriptionBefore } : {}),
        ...(c.descriptionAfter !== undefined ? { descriptionAfter: c.descriptionAfter } : {}),
      });
    }
    for (const c of hits) if (c.kind === 'renamed' && c.from) names.add(c.from);
  }
  return out;
}

// --- planning: revert and restore -------------------------------------------------------------------------

export type ConflictReason = 'changed-later' | 'removed-later' | 'recreated-later' | 'renamed-later' | 'still-referenced';
export type RevertResolution = 'keep-current' | 'use-before';

export interface LaterChange {
  id: string;
  title: string;
  date: string;
  author: string;
  pr?: number;
}

export interface RevertConflict {
  /** `path@file`, the key `resolutions` uses. */
  key: string;
  path: string;
  file: string;
  kind: LayeredChange['kind'];
  reason: ConflictReason;
  message: string;
  original: { before?: unknown; after?: unknown; beforeCss?: string; afterCss?: string };
  current?: { value: unknown; css: string };
  later: LaterChange[];
  resolution: RevertResolution;
}

export interface PlannedEdit {
  key: string;
  path: string;
  file: string;
  /** Plain words: "Set color.text.muted back to {palette.neutral.600} (Light)". */
  summary: string;
  edit: TokenEdit;
}

export interface ChangePlan {
  kind: 'revert' | 'restore';
  /** ready: can be proposed. blocked: it would add validation errors or break a contrast pair. nothing-to-do: no edit left. */
  status: 'ready' | 'blocked' | 'nothing-to-do';
  why?: string;
  title: string;
  /** Pull request title. */
  prTitle: string;
  summary: string;
  source?: { id: string; sha: string; title: string; pr?: HistoryPullRequest; date: string; author: string };
  planned: PlannedEdit[];
  edits: TokenEdit[];
  conflicts: RevertConflict[];
  /** Changes already undone on the base branch. */
  skipped: { key: string; path: string; file: string; reason: string }[];
  /** Token changes the plan makes against the current base (what reviewers see). */
  changes: LayeredChange[];
  contrast: ContrastDelta[];
  newFailures: ContrastDelta[];
  newErrors: LayerIssue[];
  tier: ChangeTier;
  /** Repo-relative files to commit: token files plus the changeset. */
  files: { path: string; content: string }[];
  changeset?: { path: string; content: string };
  branch: string;
  commitMessage: string;
  prBody: string;
  notes: string[];
}

export interface PlanCommon {
  /** The token set on the base branch now. */
  current: LayeredTokenSet;
  /** Contrast pairs for the before/after table; empty skips the gate. */
  pairs?: ContrastPair[];
  /** "Bridge docs", "Bridge MCP", "the bridge CLI". */
  tool?: string;
  author?: string;
}

export interface RevertInput extends PlanCommon {
  entry: HistoryEntry;
  /** Entries after `entry` (any order): they explain conflicts. */
  later?: HistoryEntry[];
  /** Per conflict key: keep the current value (default) or put the value from before the change back. */
  resolutions?: Record<string, RevertResolution>;
}

export interface RestoreInput extends PlanCommon {
  path: string;
  /** Token file relative to tokens.root; needed when the token lives in several files. */
  file?: string;
  /** Raw DTCG value (or a friendly form: "#ff5500", "{palette.x}"). */
  value: unknown;
  /** Where the value comes from, for the title and the PR body: "1.2.0", "#12", a date. */
  label?: string;
  /** The history item the value comes from, linked in the PR body. */
  item?: TokenHistoryItem;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const keyOf = (path: string, file: string) => `${path}@${file}`;
const show = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v));

function defIn(set: LayeredTokenSet, path: string, file: string) {
  return set.defs.find((d) => d.path === path && d.file === file);
}

/** Whether two token files resolve together in some mode combination (an alias in one can reach the other). */
function sharesCombo(set: LayeredTokenSet, a: string, b: string): boolean {
  return a === b || set.combos().some((c) => {
    const files = set.layerFiles(c).files;
    return files.includes(a) && files.includes(b);
  });
}

function laterTouching(later: HistoryEntry[], path: string, file: string, from?: string): LaterChange[] {
  return later
    .filter((e) => e.changes.some((c) => c.file === file && (c.path === path || c.from === path || (from !== undefined && (c.path === from || c.from === from)))))
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
    .map((e) => ({ id: e.id, title: e.title, date: e.date, author: e.author, ...(e.pr ? { pr: e.pr.number } : {}) }));
}

/** Inverse edits of a history entry against the current set, with the conflicts it meets. */
export function planRevert(input: RevertInput): ChangePlan {
  const { current, entry } = input;
  const later = (input.later ?? []).filter((e) => e.id !== entry.id && Date.parse(e.date) >= Date.parse(entry.date));
  const res = input.resolutions ?? {};
  const planned: PlannedEdit[] = [];
  const conflicts: RevertConflict[] = [];
  const skipped: ChangePlan['skipped'] = [];
  const config = current.config;
  const css = (path: string, file: string) => current.resolve(path, current.comboForFile(file)).css;

  for (const c of entry.changes) {
    const key = keyOf(c.path, c.file);
    const label = modeLabel(fileModes(config, c.file));
    const original = { ...(c.before !== undefined ? { before: c.before } : {}), ...(c.after !== undefined ? { after: c.after } : {}), ...(c.beforeCss ? { beforeCss: c.beforeCss } : {}), ...(c.afterCss ? { afterCss: c.afterCss } : {}) };
    const conflict = (reason: ConflictReason, message: string, cur?: { value: unknown; css: string }, editIfForced?: TokenEdit, summary?: string) => {
      const resolution = res[key] ?? 'keep-current';
      conflicts.push({ key, path: c.path, file: c.file, kind: c.kind, reason, message, original, ...(cur ? { current: cur } : {}), later: laterTouching(later, c.path, c.file, c.from), resolution });
      if (resolution === 'use-before' && editIfForced) planned.push({ key, path: c.path, file: c.file, summary: summary ?? `${editIfForced.op} ${c.path}`, edit: editIfForced });
    };
    const now = defIn(current, c.path, c.file);
    switch (c.kind) {
      case 'changed': {
        if (!now) {
          conflict('removed-later', `${c.path} was removed from ${c.file} after this change. Restoring it is a new token decision, not a revert.`, undefined, { op: 'add', path: c.path, file: c.file, value: c.before, ...(c.type ? { type: c.type } : {}), ...(c.descriptionBefore ? { description: c.descriptionBefore } : {}) }, `Add ${c.path} back with ${show(c.before)} (${label})`);
          break;
        }
        const valueField = c.fields.includes('value');
        const descField = c.fields.includes('description');
        const cur = { value: now.value, css: css(c.path, c.file) };
        const valueAt = (v: unknown) => same(now.value, v);
        const descNow = now.description ?? '';
        if (!valueField && !descField) {
          skipped.push({ key, path: c.path, file: c.file, reason: 'Only the type or extensions changed: edit those by hand.' });
          break;
        }
        if ((!valueField || valueAt(c.before)) && (!descField || descNow === (c.descriptionBefore ?? ''))) {
          skipped.push({ key, path: c.path, file: c.file, reason: 'Already back to the value from before this change.' });
          break;
        }
        const valueMoved = valueField && !valueAt(c.after) && !valueAt(c.before);
        const descMoved = descField && descNow !== (c.descriptionAfter ?? '') && descNow !== (c.descriptionBefore ?? '');
        const edit: TokenEdit = {
          op: 'set',
          path: c.path,
          file: c.file,
          ...(valueField ? { value: c.before } : {}),
          ...(descField ? { description: c.descriptionBefore ?? '' } : {}),
        };
        const summary = valueField ? `Set ${c.path} back to ${show(c.before)} (${label})` : `Put the old description of ${c.path} back (${label})`;
        if (valueMoved || descMoved) {
          conflict('changed-later', `${c.path} changed again after this change: it is now ${cur.css || show(cur.value)}, not ${c.afterCss || show(c.after)}.`, cur, edit, summary);
          break;
        }
        planned.push({ key, path: c.path, file: c.file, summary, edit });
        break;
      }
      case 'added': {
        if (!now) {
          skipped.push({ key, path: c.path, file: c.file, reason: 'Already removed.' });
          break;
        }
        const users = current.referencedBy(c.path).filter((u) => u.path !== c.path && sharesCombo(current, u.file, c.file));
        const edit: TokenEdit = { op: 'remove', path: c.path, file: c.file };
        const summary = `Remove ${c.path} (${label})`;
        if (!same(now.value, c.after)) {
          conflict('changed-later', `${c.path} changed after it was added: it is now ${css(c.path, c.file) || show(now.value)}.`, { value: now.value, css: css(c.path, c.file) }, edit, summary);
          break;
        }
        if (users.length) {
          conflict('still-referenced', `${users.length} token(s) alias ${c.path} now (${users.slice(0, 4).map((u) => u.path).join(', ')}${users.length > 4 ? ', ...' : ''}). Removing it would break them.`, { value: now.value, css: css(c.path, c.file) }, edit, summary);
          break;
        }
        planned.push({ key, path: c.path, file: c.file, summary, edit });
        break;
      }
      case 'removed': {
        const edit: TokenEdit = { op: 'add', path: c.path, file: c.file, value: c.before, ...(c.type ? { type: c.type } : {}), ...(c.descriptionBefore ? { description: c.descriptionBefore } : {}) };
        const summary = `Add ${c.path} back with ${show(c.before)} (${label})`;
        if (now) {
          if (same(now.value, c.before)) skipped.push({ key, path: c.path, file: c.file, reason: 'Already back.' });
          else conflict('recreated-later', `${c.path} was added again later with another value (${css(c.path, c.file) || show(now.value)}).`, { value: now.value, css: css(c.path, c.file) });
          break;
        }
        planned.push({ key, path: c.path, file: c.file, summary, edit });
        break;
      }
      case 'renamed': {
        const from = c.from!;
        const back = defIn(current, from, c.file);
        if (back && !now) {
          skipped.push({ key, path: c.path, file: c.file, reason: `Already named ${from}.` });
          break;
        }
        if (!now) {
          conflict('renamed-later', `${c.path} no longer exists in ${c.file}: it was renamed or removed again later.`);
          break;
        }
        if (back) {
          conflict('recreated-later', `${from} exists again in ${c.file}, so ${c.path} cannot take its old name back.`, { value: back.value, css: css(from, c.file) });
          break;
        }
        // A rename moves every file that defines the token, so one edit covers light and dark.
        if (planned.some((p) => p.edit.op === 'rename' && p.path === c.path)) {
          skipped.push({ key, path: c.path, file: c.file, reason: 'Covered by the rename above.' });
          break;
        }
        planned.push({ key, path: c.path, file: c.file, summary: `Rename ${c.path} back to ${from} and repoint its aliases`, edit: { op: 'rename', path: c.path, newPath: from } });
        break;
      }
    }
  }

  const prLink = entry.pr ? (entry.pr.url ? `[#${entry.pr.number}](${entry.pr.url})` : `#${entry.pr.number}`) : `commit ${entry.sha.slice(0, 7)}`;
  const title = `Revert: ${entry.title}`;
  const lines = [
    `Reverts ${prLink} ("${entry.title}"), merged ${entry.date.slice(0, 10)} by ${entry.author}.`,
    '',
    `Original reason: ${entry.why}`,
    '',
    'Bridge computed the inverse token edits against the current base branch, not a blind git revert: tokens that changed again since are listed as conflicts and kept unless a reviewer chose to restore them.',
  ];
  if (conflicts.length) {
    lines.push('', '### Conflicts', '', '| Token | File | Why | Decision |', '| --- | --- | --- | --- |');
    for (const k of conflicts) lines.push(`| \`${k.path}\` | ${k.file} | ${k.message.replace(/\|/g, '\\|')}${k.later.length ? ` Later: ${k.later.map((l) => (l.pr ? `#${l.pr}` : l.id)).join(', ')}.` : ''} | ${k.resolution === 'use-before' ? 'restore the old value' : 'keep current'} |`);
  }
  if (skipped.length) lines.push('', `${skipped.length} change(s) were already undone on the base branch and are left alone.`);
  return finishPlan({ ...input, kind: 'revert', title, prTitle: title, summary: lines.join('\n'), planned, conflicts, skipped, source: entry });
}

/** One token back to an earlier value, in one file (one mode). */
export function planRestore(input: RestoreInput): ChangePlan {
  const { current, path } = input;
  const files = [...new Set(current.defs.filter((d) => d.path === path).map((d) => d.file))];
  if (!files.length) throw new Error(`Token "${path}" does not exist on the base branch. Restoring a removed token is a revert of the change that removed it.`);
  const file = input.file ?? (files.length === 1 ? files[0]! : undefined);
  if (!file) throw new Error(`"${path}" is defined in ${files.join(', ')}. Pass the file (the mode) to restore.`);
  if (!files.includes(file)) throw new Error(`"${path}" is not defined in ${file}. It is defined in: ${files.join(', ')}.`);
  const label = modeLabel(fileModes(current.config, file));
  const from = input.label ? ` from ${input.label}` : '';
  const planned: PlannedEdit[] = [{ key: keyOf(path, file), path, file, summary: `Set ${path} to ${show(input.value)} (${label})`, edit: { op: 'set', path, file, value: input.value } }];
  const title = `Restore ${path} (${label})${from}`;
  const item = input.item;
  const summary = [
    `Restores \`${path}\` in ${label} to ${show(input.value)}${from}.`,
    ...(item ? ['', `That value came from ${item.pr ? (item.pr.url ? `[#${item.pr.number}](${item.pr.url})` : `#${item.pr.number}`) : `commit ${item.sha.slice(0, 7)}`} ("${item.title}"), ${item.date.slice(0, 10)}, by ${item.author}.`] : []),
  ].join('\n');
  return finishPlan({ ...input, kind: 'restore', title, prTitle: title, summary, planned, conflicts: [], skipped: [] });
}

const issueKey = (i: LayerIssue) => `${i.code}|${i.path ?? ''}|${i.file ?? ''}|${i.message}`;

interface FinishInput extends PlanCommon {
  kind: 'revert' | 'restore';
  title: string;
  prTitle: string;
  summary: string;
  planned: PlannedEdit[];
  conflicts: RevertConflict[];
  skipped: ChangePlan['skipped'];
  source?: HistoryEntry;
}

function finishPlan(p: FinishInput): ChangePlan {
  const { current } = p;
  const config = current.config;
  const edits = p.planned.map((x) => x.edit);
  const notes: string[] = [];
  const empty: ChangeTier = classifyLayered([], [], config);
  const base = {
    kind: p.kind,
    title: p.title,
    prTitle: p.prTitle,
    summary: p.summary,
    ...(p.source ? { source: { id: p.source.id, sha: p.source.sha, title: p.source.title, ...(p.source.pr ? { pr: p.source.pr } : {}), date: p.source.date, author: p.source.author } } : {}),
    planned: p.planned,
    edits,
    conflicts: p.conflicts,
    skipped: p.skipped,
    branch: `${config.governance.branchPrefix}${slugify(p.title, 48) || p.kind}`,
  };
  const nothing = (why: string): ChangePlan => ({ ...base, status: 'nothing-to-do', why, changes: [], contrast: [], newFailures: [], newErrors: [], tier: empty, files: [], commitMessage: '', prBody: '', notes });
  if (!edits.length) return nothing(p.conflicts.length ? 'Every change conflicts with a later one. Choose "restore the old value" on a conflict to include it.' : 'Nothing left to undo: the base branch already has the old values.');
  let result;
  try {
    result = applyTokenEdits(current, edits);
  } catch (e) {
    return { ...nothing((e as Error).message), status: 'blocked' };
  }
  notes.push(...result.notes);
  const after = new LayeredTokenSet(config, result.files);
  const changes = diffLayered(current, after);
  if (!changes.length) return nothing('The edits leave every token as it is now.');
  const prev = new Set(validateLayered(current).map(issueKey));
  const newErrors = validateLayered(after).filter((i) => i.level === 'error' && !prev.has(issueKey(i)));
  const pairs = p.pairs ?? [];
  const modes = config.contrast?.modes;
  const contrast = pairs.length ? contrastDelta(runLayeredContrast(current, pairs, modes), runLayeredContrast(after, pairs, modes)) : [];
  const newFailures = contrast.filter((d) => d.passBefore && !d.passAfter);
  const tier = classifyLayered(changes, [], config);
  const impact = layeredImpact(current, after, changes);
  const prBody = composeProposalBody({ summary: p.summary, changes, contrast, impact, tier, validationErrors: newErrors.length, tool: p.tool ?? 'Bridge', ...(p.author ? { author: p.author } : {}) });
  const changeset = config.changesets ? { path: `${config.changesets.dir.replace(/\/$/, '')}/bridge-${slugify(p.title, 48) || p.kind}.md`, content: formatChangeset(config.changesets.package, tier.bump, p.title.replace(/\.?$/, '.')) } : undefined;
  const files = [...result.touched.map((f) => ({ path: current.repoPath(f), content: result.files.get(f)! })), ...(changeset ? [changeset] : [])];
  const commitMessage = `${p.kind === 'revert' ? 'revert(tokens)' : 'fix(tokens)'}: ${p.title.replace(/^Revert: /, '')}\n\n${p.source?.pr ? `Reverts #${p.source.pr.number}. ` : ''}Tier ${tier.tier}. Planned with ${p.tool ?? 'Bridge'}.`;
  const blocked = newErrors.length || newFailures.length;
  return {
    ...base,
    status: blocked ? 'blocked' : 'ready',
    ...(blocked ? { why: [newErrors.length ? `${newErrors.length} new validation error(s)` : '', newFailures.length ? `${newFailures.length} contrast pair(s) would fail` : ''].filter(Boolean).join(' and ') } : {}),
    changes,
    contrast,
    newFailures,
    newErrors,
    tier,
    files,
    ...(changeset ? { changeset } : {}),
    commitMessage,
    prBody,
    notes,
  };
}

/** A patch-like JSON of a plan, for people without a GitHub token: apply it by hand or hand it to an agent. */
export function planToJson(plan: ChangePlan): Record<string, unknown> {
  return {
    bridge: 'change-plan',
    kind: plan.kind,
    status: plan.status,
    title: plan.prTitle,
    branch: plan.branch,
    tier: plan.tier.tier,
    bump: plan.tier.bump,
    edits: plan.edits,
    conflicts: plan.conflicts.map((c) => ({ key: c.key, reason: c.reason, message: c.message, resolution: c.resolution })),
    files: plan.files,
    commitMessage: plan.commitMessage,
    prBody: plan.prBody,
  };
}

// --- report -----------------------------------------------------------------------------------------------

export interface HistoryReport {
  source: 'github' | 'git' | 'demo';
  /** `owner/name@main`, a local path and ref, or "demo". */
  label: string;
  ref: string;
  entries: HistoryEntry[];
  releases: HistoryRelease[];
  timeline: VersionGroup[];
  /** Version in the changesets package's package.json on the ref. */
  currentVersion?: string;
  /** More commits exist than were read (raise the limit to go further back). */
  truncated: boolean;
  /** True when every entry is fixture data. The docs site shows it only behind the demo toggle. */
  demo?: boolean;
}

/** Where the changesets package may keep CHANGELOG.md and package.json: the tokens root and its parents. */
export function packageDirCandidates(config: BridgeConfig): string[] {
  const parts = config.tokens.root.replace(/\/$/, '').split('/').filter((p) => p && p !== '.');
  const out: string[] = [];
  for (let i = parts.length; i >= 0; i--) out.push(parts.slice(0, i).join('/'));
  return out;
}

/** Releases from a CHANGELOG and tags, dated by the tags when the CHANGELOG has no dates. */
export function mergeReleases(changelog: HistoryRelease[], tags: HistoryRelease[]): HistoryRelease[] {
  const byVersion = new Map<string, HistoryRelease>();
  for (const r of [...changelog, ...tags]) {
    const prev = byVersion.get(r.version);
    byVersion.set(r.version, prev ? { ...r, ...prev, ...(prev.date ? {} : r.date ? { date: r.date } : {}), ...(prev.sha ? {} : r.sha ? { sha: r.sha } : {}) } : r);
  }
  return [...byVersion.values()];
}

export function buildReport(args: Omit<HistoryReport, 'timeline' | 'entries'> & { entries: HistoryEntry[] }): HistoryReport {
  const entries = assignVersions(args.entries, args.releases).sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  return { ...args, entries, timeline: versionTimeline(entries, args.releases) };
}
