// Picking an exploration up where it was left: the pure rules shared by the Studio exploration page (not started,
// exploring), Claude (bridge_continue_exploration) and the CLI. An exploration is "not started" while its branch only
// carries Bridge notes (.bridge/, the note file Bridge writes when it starts one); once something else changed it is
// "exploring". What changed is said in words: the files mapped to the screens and components they are, else the
// commit subjects. The line a designer pastes in Claude to continue it names the exploration by the ref the MCP
// server resolves (#12 in the design system repository, shop#12 in a product's own repository).
import { explorationRefLabel, type ExplorationStatus } from './explorations';

/** The phrase Claude recognizes to resume an exploration ("Continue Bridge exploration #12"). */
export const CONTINUE_PHRASE = 'Continue Bridge exploration';

/** True when every changed file is a Bridge note (.bridge/): nothing the product is built from changed yet. */
export const onlyNotes = (files: readonly string[] | null | undefined): boolean => Boolean(files?.length) && files!.every((f) => f.startsWith('.bridge/'));

/**
 * Where a running exploration stands: not started (nothing beyond the Bridge notes), exploring (something changed),
 * or handed on (done exploring, being built, shipped, closed, archived: the pages keep their own layout). Files
 * unknown (null): exploring, so a failed read never hides work behind "Nothing built yet".
 */
export function explorationStage(x: { status: ExplorationStatus; archived?: boolean | null | undefined; files: readonly string[] | null | undefined }): 'not-started' | 'exploring' | 'handed' {
  if (x.status !== 'active' || x.archived) return 'handed';
  if (x.files && (x.files.length === 0 || onlyNotes(x.files))) return 'not-started';
  return 'exploring';
}

export interface ContinueRef {
  number: number;
  name: string;
  /** The product's display name ("Admin demo"). */
  productName: string;
  /** Set when the exploration lives in a product's own repository: its key ("shop") and that repository. */
  product?: string | null | undefined;
  repo?: string | null | undefined;
}

/** The ref Claude resolves: "#12", or "shop#12" in a product's own repository. */
export const continueRef = (x: Pick<ContinueRef, 'number' | 'product' | 'repo'>): string => explorationRefLabel(x);

/**
 * The two lines a designer pastes to continue: in the Claude app, a sentence; in a terminal, the claude command.
 * No em dash: the line is copied as is.
 */
export function continueLines(x: ContinueRef): { app: string; terminal: string } {
  const ref = continueRef(x);
  const name = x.name.replace(/"/g, "'").trim();
  return {
    app: `${CONTINUE_PHRASE} ${ref} "${name}" in ${x.productName} and use the Bridge library.`,
    terminal: `claude "${CONTINUE_PHRASE} ${ref}"`,
  };
}

/** Reads "Continue Bridge exploration #12" or "... shop#12" back into a ref ("#12", "shop#12"); null otherwise. */
export function parseContinueLine(text: string): string | null {
  const m = /continue\s+bridge\s+exploration\s+((?:[a-z0-9][\w.-]*)?#\d+)/i.exec(text);
  return m ? m[1]!.toLowerCase() : null;
}

// ---------------------------------------------------------------------------------------------------------------
// What changed, in words

/** "BulkActionsBar" -> "Bulk actions bar", "DSBridgePanel" -> "DS bridge panel". */
export function wordsOf(name: string): string {
  const spaced = name
    .replace(/[-_]+/g, ' ')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim();
  const words = spaced.split(/\s+/).filter(Boolean);
  return words.map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : /^[A-Z]{2,}$/.test(w) ? w : w.toLowerCase())).join(' ');
}

const SKIP = [/^\.bridge\//, /^\.changeset\//, /^\.github\//, /\.(test|spec|stories)\.[jt]sx?$/, /\.d\.ts$/, /(^|\/)package(-lock)?\.json$/, /\.md$/, /(^|\/)__snapshots__\//, /\.docs\.json$/];
const CODE = /\.(tsx|jsx|ts|js|vue|svelte|astro|css|scss)$/;
const SCREEN_DIRS = /(^|\/)(pages|routes|screens|views|app)\//;

/**
 * What one file is, for a designer: a component ("Bulk actions bar"), a screen ("Orders screen"), the tokens
 * ("Tokens"), or null when it says nothing to them (helpers, config, tests, notes).
 */
export function thingOf(path: string): string | null {
  if (SKIP.some((r) => r.test(path))) return null;
  if (/(^|\/)tokens\/src\//.test(path) || /\.tokens\.json$/.test(path)) return 'Tokens';
  if (!CODE.test(path)) return null;
  const parts = path.split('/');
  const file = parts[parts.length - 1]!;
  const base = file.replace(/\.module\.(css|scss)$/, '').replace(/\.[^.]+$/, '');
  // A component folder: components/Button/Button.tsx, components/Button/index.ts.
  const ci = parts.lastIndexOf('components');
  if (ci >= 0 && ci < parts.length - 2 && /^[A-Z]/.test(parts[ci + 1]!)) return wordsOf(parts[ci + 1]!);
  if (/^[A-Z][A-Za-z0-9]+$/.test(base)) return wordsOf(base);
  if (SCREEN_DIRS.test(path)) {
    const name = base === 'index' || base === 'page' ? parts[parts.length - 2] : base;
    if (name && !/^\[/.test(name) && !['pages', 'routes', 'screens', 'views', 'app', 'src'].includes(name)) return `${wordsOf(name)} screen`;
  }
  return null;
}

/** The distinct things the files are, in file order. */
export function changedThings(files: readonly string[]): string[] {
  const out: string[] = [];
  for (const f of files) {
    const t = thingOf(f);
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/** "A", "A and B", "A, B and 3 more". */
export function listThings(things: readonly string[], max = 2): string {
  if (things.length <= max) return things.length === 2 ? `${things[0]} and ${things[1]}` : (things[0] ?? '');
  return `${things.slice(0, max).join(', ')} and ${things.length - max} more`;
}

// ---------------------------------------------------------------------------------------------------------------
// Activity

/** A commit on the branch, as GitHub lists them (GET /pulls/{n}/commits). */
export interface BranchCommitLike {
  sha: string;
  commit: { message: string; author?: { name?: string | null; date?: string | null } | null; committer?: { date?: string | null } | null };
  author?: { login?: string | null } | null;
}

export interface ActivityEvent {
  /** "claude" for Claude's work, else the person's login (or git name). */
  who: string;
  /** Claude alone: a Claude account, or Claude's trailer with no person as the author (a bot or none). */
  claude: boolean;
  /** A person's commit Claude co-wrote (its co-author trailer or footer): shown as "Florian with Claude". */
  withClaude?: boolean;
  /** After the actor: "added row selection to the Orders table". */
  text: string;
  at: string;
  sha?: string;
}

const PAST: Record<string, string> = {
  add: 'added',
  build: 'built',
  change: 'changed',
  drop: 'dropped',
  fix: 'fixed',
  make: 'made',
  move: 'moved',
  polish: 'polished',
  remove: 'removed',
  rename: 'renamed',
  replace: 'replaced',
  rework: 'reworked',
  set: 'set',
  show: 'showed',
  split: 'split',
  swap: 'swapped',
  try: 'tried',
  tweak: 'tweaked',
  update: 'updated',
  use: 'used',
  wire: 'wired',
};

/** True when the commit carries Claude's co-author trailer or the Claude Code footer. */
export function isClaudeAssisted(c: BranchCommitLike): boolean {
  const m = c.commit.message;
  return /co-authored-by:\s*claude/i.test(m) || /generated with \[?claude/i.test(m);
}

const isClaudeAccount = (c: BranchCommitLike): boolean => /claude/i.test(c.author?.login ?? '') || /^claude\b/i.test(c.commit.author?.name ?? '');
const isBot = (name: string): boolean => /\[bot\]$|^github-actions\b|-bot$/i.test(name);

/** The person who authored the commit (GitHub login, else git name), or null for a bot, Claude or nobody. */
export function humanAuthorOf(c: BranchCommitLike): string | null {
  if (isClaudeAccount(c)) return null;
  const login = c.author?.login?.trim();
  if (login) return isBot(login) ? null : login;
  const name = c.commit.author?.name?.trim();
  return name && !isBot(name) ? name : null;
}

/**
 * True when Claude alone wrote the commit: a Claude account, or Claude's trailer on a commit no person authored (a
 * bot, or no author). A person's commit with Claude's trailer is theirs, made with Claude (isClaudeAssisted).
 */
export function isClaudeCommit(c: BranchCommitLike): boolean {
  return isClaudeAccount(c) || (isClaudeAssisted(c) && !humanAuthorOf(c));
}

/** True for the commit Bridge writes when it starts an exploration (only the note file). */
export const isStartCommit = (c: BranchCommitLike): boolean => /^chore\(explore\): start /.test(c.commit.message);

/**
 * A commit subject in words after the actor: "feat(orders): add row selection" -> "added row selection". Conventional
 * prefixes go, an imperative first verb turns past, em dashes become commas. Other subjects: "changed things: <subject>".
 */
export function subjectWords(subject: string): string {
  const s = subject
    .replace(/^[a-z]+(\([^)]*\))?!?:\s*/i, '')
    .replace(/\s*—\s*/g, ', ')
    .replace(/\s*\(#\d+\)\s*$/, '')
    .trim();
  if (!s) return 'made a change';
  const [first, ...rest] = s.split(/\s+/);
  const past = PAST[first!.toLowerCase()];
  if (past) return [past, ...rest].join(' ');
  if (/^(added|built|changed|fixed|made|moved|removed|renamed|replaced|updated|used|tried|swapped|tweaked)$/i.test(first!)) return [first!.toLowerCase(), ...rest].join(' ');
  return `changed ${/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s}`;
}

const dateOf = (c: BranchCommitLike) => c.commit.author?.date ?? c.commit.committer?.date ?? '';

/**
 * The branch's activity, newest first: one event per commit (Bridge's start commit left out), then "started the
 * exploration". `limit` keeps the newest ones, the start event included when it fits.
 */
export function explorationActivity(input: { commits: readonly BranchCommitLike[]; author: string; startedAt?: string | null | undefined; limit?: number }): ActivityEvent[] {
  const commits = input.commits.filter((c) => !isStartCommit(c));
  const events: ActivityEvent[] = commits
    .map((c) => {
      const claude = isClaudeCommit(c);
      const withClaude = !claude && isClaudeAssisted(c);
      const who = claude ? 'claude' : (humanAuthorOf(c) ?? input.author);
      return { who, claude, ...(withClaude ? { withClaude } : {}), text: subjectWords(c.commit.message.split('\n')[0]!), at: dateOf(c), sha: c.sha };
    })
    .sort((a, b) => b.at.localeCompare(a.at));
  const start = input.commits.find(isStartCommit);
  const startedAt = input.startedAt ?? (start ? dateOf(start) : null);
  if (startedAt) events.push({ who: input.author, claude: false, text: 'started the exploration', at: startedAt });
  return events.slice(0, input.limit ?? events.length);
}

/**
 * The line under the title once something changed: who changed what, from the branch files when they name screens
 * or components ("changed Orders table and Bulk actions bar"), else the latest commit in words. Null before any change.
 */
export function lastActivity(input: { commits: readonly BranchCommitLike[]; files: readonly string[] | null | undefined; author: string }): { who: string; claude: boolean; withClaude?: boolean; text: string; at: string } | null {
  const latest = explorationActivity({ commits: input.commits, author: input.author }).find((e) => e.text !== 'started the exploration');
  if (!latest) return null;
  const things = changedThings(input.files ?? []);
  return { who: latest.who, claude: latest.claude, ...(latest.withClaude ? { withClaude: true } : {}), text: things.length ? `changed ${listThings(things)}` : latest.text, at: latest.at };
}

/** "just now", "5 min ago", "2 h ago", "Yesterday", "3 days ago", then the date ("Oct 12"). */
export function shortAgo(iso: string, now: Date = new Date()): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, (now.getTime() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const days = Math.floor(s / 86400);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(t).toLocaleDateString('en', { month: 'short', day: 'numeric', ...(new Date(t).getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
}

/** "today", "yesterday", "3 days ago", "Oct 12": when it was started, after "Started by Ann · Admin demo ·". */
export function startedWhen(iso: string, now: Date = new Date()): string {
  const t = new Date(iso);
  if (!Number.isFinite(t.getTime())) return '';
  const day = (d: Date) => Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
  const diff = day(now) - day(t);
  if (diff <= 0) return 'today';
  if (diff === 1) return 'yesterday';
  if (diff < 7) return `${diff} days ago`;
  return t.toLocaleDateString('en', { month: 'short', day: 'numeric', ...(t.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
}

/** The actor in words: "Claude", "Florian", or "Florian with Claude" when Claude co-wrote a person's change. */
export function actorName(e: Pick<ActivityEvent, 'who' | 'claude' | 'withClaude'>, names?: Record<string, string>): string {
  if (e.claude) return 'Claude';
  const n = names?.[e.who] ?? e.who;
  return e.withClaude ? `${n} with Claude` : n;
}

/**
 * Where it stands, in one or two plain sentences, for Claude to say first when the designer continues it. No
 * technical words: no branch, commit or pull request.
 */
export function whereItStands(input: { name: string; stage: 'not-started' | 'exploring' | 'handed'; statusLabel?: string; events: readonly ActivityEvent[]; files: readonly string[] | null | undefined; names?: Record<string, string>; now?: Date }): string {
  if (input.stage === 'not-started') return `"${input.name}" is started but nothing is built yet.`;
  if (input.stage === 'handed') return `"${input.name}" is ${input.statusLabel ? input.statusLabel.toLowerCase() : 'with the developers'}.`;
  const things = changedThings(input.files ?? []);
  const latest = input.events.find((e) => e.text !== 'started the exploration');
  const who = (e: ActivityEvent) => actorName(e, input.names);
  const so = things.length ? `So far it changes ${listThings(things, 3)}.` : 'Something changed already.';
  return latest ? `${so} Last: ${who(latest)} ${latest.text}, ${shortAgo(latest.at, input.now).toLowerCase()}.` : so;
}
