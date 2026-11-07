// What a GitHub webhook delivery means for the designers who joined by email (notifications, phase 1). Pure: no
// Redis, no network, no email. api/_lib/notify.ts finds who each notice is for (the member Bridge keeps as the author
// of the task or suggestion, never anyone named on GitHub) and sends or keeps it.
//
// Phase 1, the five things an email designer is blind to today (docs/HOSTED.md, "Notifications"):
//   question             someone commented on their open task (an issue they filed through Bridge),
//                        or labeled it needs-design (the rule of Studio's devQuestionOf)                 needs them
//   look                 the developers' version of their task is ready for a design look (a pull
//                        request that closes the task, opened ready or marked ready)                    needs them
//   changes              a lead asked for changes on their library suggestion                            needs them
//   declined             someone closed their task as not planned                                       news
//   shipped              their task was closed as done, or a pull request that closes it was merged      news
//   suggestion-declined  their library suggestion was closed without being added                         news
// Between a designer and their design lead, read from the exploration's block when its body changes (pull_request
// edited, leadNoticesOf): who it is for and who did it are in the block, so a write Bridge's app made for an email
// member counts, and nobody hears about their own act:
//   lead-ask, lead-answer, lead-delegated   a lead is asked, answered, asked in another's place          needs them
//   lead-reminder                           a lead did not answer in 3 days (once, notify.ts)            needs them
//   lead-question, lead-changes,
//   lead-took-back, lead-not-doing,
//   lead-handed                             a lead's word to the designer                                needs them
//   lead-ok                                 it went to the developers                                    news
// Anything Bridge itself did for a member (the Bridge app's bot, a "(via Bridge)" comment) and anything another bot
// did is never news: the designer did it, or nobody did.

import { canonicalRepo } from '../../src/lib/team-path.js';
import { explorationBlockOf } from './exploration-member.js';

export type NotifyKind =
  | 'question'
  | 'look'
  | 'changes'
  | 'declined'
  | 'shipped'
  | 'suggestion-declined'
  | 'lead-ask'
  | 'lead-answer'
  | 'lead-delegated'
  | 'lead-reminder'
  | 'lead-question'
  | 'lead-changes'
  | 'lead-took-back'
  | 'lead-not-doing'
  | 'lead-handed'
  | 'lead-ok'
  | 'lead-pm-ok'
  | 'lead-pm-changes'
  | 'lead-pm-call';

/** The kinds that wait on the designer: sent right away by default. The others go in the daily summary. */
export const NEEDS_KINDS: ReadonlySet<NotifyKind> = new Set(['question', 'look', 'changes', 'lead-ask', 'lead-answer', 'lead-delegated', 'lead-reminder', 'lead-question', 'lead-changes', 'lead-took-back', 'lead-not-doing', 'lead-handed', 'lead-pm-changes', 'lead-pm-call']);

/** Where the item lives: a library suggestion only counts in the team's own repository. */
export type NoticeScope = 'any' | 'library';

export interface Notice {
  kind: NotifyKind;
  /** The repository it happened in, owner/name, lower case. */
  repo: string;
  /** The numbers in `repo` that may be the member's (the task or suggestion itself, or the tasks a pull request closes). */
  items: number[];
  /** What it is called, in the designer's words ("Pill buttons"); the stored name wins when Bridge kept one. */
  title: string;
  /** Who did it on GitHub. Bridge names them by their Bridge account name when they have one. */
  actor: { login: string; id: number | null };
  /** The exploration in the design team's copy the task links, when its body says so. */
  copy: { repo: string; number: number } | null;
  scope: NoticeScope;
  /**
   * What they wrote, when the event carries it (the question's comment, the lead's review note): the start of it, for
   * the right-away email only. Never kept: the daily summary names things, it never quotes them.
   */
  quote?: string;
  /** Who it is for, for a talk with a lead: these GitHub logins (the leads), else the exploration's keeper. */
  to?: string[];
  /** The name the block gives who did it: a member without GitHub has no login to look up. */
  actorName?: string;
  /** It starts waiting on a lead (a reminder in 3 days), or it stops. */
  waits?: boolean;
  stops?: boolean;
}

/** The context the mapper does not read from the payload. */
export interface NotifyContext {
  /** Logins of the Bridge GitHub App's bot (lower case), when known; any `[bot]` sender is skipped anyway. */
  botLogins?: readonly string[];
}

const REPO_FULL = /^[\w.-]+\/[\w.-]+$/;
const obj = (v: unknown): Record<string, any> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {});

/** A person, not a bot: GitHub's type says User and the login is not one of the Bridge app's. */
function human(user: unknown, ctx: NotifyContext): { login: string; id: number | null } | null {
  const u = obj(user);
  if (typeof u.login !== 'string' || !u.login) return null;
  if (u.type !== undefined && u.type !== 'User') return null;
  const login = u.login as string;
  if (/\[bot\]$/i.test(login) || (ctx.botLogins ?? []).some((b) => b.toLowerCase() === login.toLowerCase())) return null;
  return { login, id: Number.isSafeInteger(u.id) ? (u.id as number) : null };
}

/** A comment Bridge posted for a member ("**Mia** (via Bridge):"): the designer said it, nobody else. */
export const VIA_BRIDGE = /^\s*\*\*[^*\n]{1,120}\*\* \(via Bridge\):/;
/** A design lead's words to the developers, sent from Bridge: for them, never a question to a designer. */
export const LEAD_NOTE = /^\s*\*\*[^*\n]{1,120}\*\* \(design lead\):/;
// Studio's own words on a task (lib/review-state.ts devQuestionOf reads a question the same way; a test holds them
// equal): a design review the designer sent, taking the task back to exploring, and the label that asks for design.
export const DESIGN_REVIEW_PREFIX = 'Design review from Bridge:';
export const TASK_BACK_PREFIX = 'The design team took this back to exploring.';
export const NEEDS_DESIGN_LABEL = 'needs-design';
const bridgeWords = (body: string) => VIA_BRIDGE.test(body) || LEAD_NOTE.test(body) || body.trim().startsWith(DESIGN_REVIEW_PREFIX) || body.trim().startsWith(TASK_BACK_PREFIX);

const upperFirst = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/**
 * "Design: add a toast alert" (the task title Done exploring writes) as "Add a toast alert", the way Studio names it
 * (the rule of lib/pr-title humanTitle, kept here so the functions import nothing of the site: no "feat:" prefix, a
 * capital first); any title cleaned and kept short.
 */
export function cleanTitle(raw: unknown): string {
  const t = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().replace(/^Design:\s*/i, '') : '';
  // No em dash in anything Bridge writes: one in a title becomes a comma.
  const s = upperFirst(t.replace(/^(?:[a-z]+|Exploration|Feat|Fix|Chore|Docs|Refactor|Revert|Tokens)(\([^)]*\))?!?:\s*/, '').replace(/\s*\u2014\s*/g, ', '));
  return s.length > 90 ? `${s.slice(0, 89).trimEnd()}…` : s;
}

/** Characters of what someone wrote that an email quotes. */
export const QUOTE_MAX = 400;

/**
 * The start of what someone wrote (a comment, a review note) as an email quotes it: plain text, no HTML comment or
 * tag, an image as "(image)", blank lines folded, no em dash, at most QUOTE_MAX characters cut on a word. Empty when
 * nothing is left.
 */
export function quoteOf(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const t = raw
    .replace(/\r\n?/g, '\n')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '(image)')
    .replace(/<img\b[^>]*>/gi, '(image)')
    .replace(/<[^>]{1,200}>/g, '')
    .replace(/\s*\u2014\s*/g, ', ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (t.length <= QUOTE_MAX) return t;
  const cut = t.slice(0, QUOTE_MAX);
  const space = cut.search(/\s\S*$/);
  return `${(space > QUOTE_MAX * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * The issue numbers a pull request body closes in its own repository: "Closes #12", "fixes #3", "Resolves
 * https://github.com/<repo>/issues/7" (GitHub's closing keywords). At most 5.
 */
export function closedIssues(body: unknown, repo: string): number[] {
  if (typeof body !== 'string') return [];
  const out = new Set<number>();
  const kw = '(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)';
  for (const m of body.matchAll(new RegExp(`\\b${kw}:?\\s+#(\\d{1,9})\\b`, 'gi'))) out.add(Number(m[1]));
  const [o, n] = repo.split('/');
  if (o && n) {
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const m of body.matchAll(new RegExp(`\\b${kw}:?\\s+https://github\\.com/${esc(o)}/${esc(n)}/issues/(\\d{1,9})\\b`, 'gi'))) out.add(Number(m[1]));
  }
  return [...out].filter((x) => x > 0).slice(0, 5);
}

/** The first pull request of another repository a task body links (Done exploring links the exploration in the copy). */
export function linkedCopy(body: unknown, repo: string): { repo: string; number: number } | null {
  if (typeof body !== 'string') return null;
  for (const m of body.matchAll(/https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d{1,9})\b/g)) {
    // Under its current name: a link written before a rename is the same repository.
    const r = canonicalRepo(m[1]!).toLowerCase();
    if (r !== canonicalRepo(repo).toLowerCase() && REPO_FULL.test(r)) return { repo: r, number: Number(m[2]) };
  }
  return null;
}

interface BlockDecision {
  kind?: unknown;
  by?: unknown;
  byName?: unknown;
  text?: unknown;
  to?: unknown;
}

const decisionsIn = (b: Record<string, unknown> | null): BlockDecision[] => (Array.isArray(b?.decisions) ? (b.decisions as BlockDecision[]).filter((d) => d && typeof d === 'object') : []);
const logins = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !x.includes('@') && !x.includes('/')) : []);
const leadKinds: Record<string, NotifyKind> = { question: 'lead-question', changes: 'lead-changes', 'take-back': 'lead-took-back', 'not-doing': 'lead-not-doing', handed: 'lead-handed', 'looks-right': 'lead-ok' };

/**
 * What changed in the talk between a designer and their lead, from the body before and after. Each new decision, once:
 * a redelivery was refused by the webhook, and a decision only counts past the ones the old body had.
 */
export function leadNoticesOf(before: unknown, after: unknown, base: { repo: string; number: number }): Notice[] {
  const was = explorationBlockOf(before);
  const now = explorationBlockOf(after);
  if (!now) return [];
  const had = decisionsIn(was).length;
  const fresh = decisionsIn(now).slice(had);
  const title = cleanTitle(now.name);
  const asked = logins(now.leadAskedTo);
  const common = { repo: base.repo, items: [base.number], title, copy: null, scope: 'any' as const };
  const actor = (d: BlockDecision) => ({ login: typeof d.by === 'string' ? d.by : '', id: null });
  const out: Notice[] = [];
  const named = (d: BlockDecision) => (typeof d.byName === 'string' && d.byName ? { actorName: d.byName } : {});
  const quoted = (d: BlockDecision) => {
    const q = quoteOf(d.text);
    return q ? { quote: q } : {};
  };
  for (const d of fresh) {
    if (typeof d.kind !== 'string') continue;
    if (d.kind === 'answer') {
      const all = decisionsIn(now);
      const lastAsk = [...all.slice(0, all.indexOf(d))].reverse().find((x) => x.kind === 'question' || x.kind === 'changes' || x.kind === 'take-back');
      const to = typeof lastAsk?.by === 'string' ? [lastAsk.by] : asked;
      out.push({ ...common, kind: 'lead-answer', actor: actor(d), ...named(d), ...quoted(d), to, waits: true });
    } else if (d.kind === 'asked-someone') {
      out.push({ ...common, kind: 'lead-delegated', actor: actor(d), ...named(d), to: logins(d.to), waits: true });
    } else if (leadKinds[d.kind]) {
      out.push({ ...common, kind: leadKinds[d.kind]!, actor: actor(d), ...named(d), ...quoted(d), stops: true });
    }
  }
  // Asked now and it was not before, with nothing else said: Done exploring, or sent back without a word.
  if (typeof now.leadAskedAt === 'string' && typeof was?.leadAskedAt !== 'string' && !fresh.some((d) => d.kind === 'answer')) {
    const by = typeof now.leadAskedBy === 'string' ? now.leadAskedBy : '';
    const byName = typeof now.leadAskedByName === 'string' ? now.leadAskedByName : typeof now.memberName === 'string' ? now.memberName : '';
    out.push({ ...common, kind: 'lead-ask', actor: { login: by, id: null }, ...(byName ? { actorName: byName } : {}), to: asked, waits: true });
  }
  return out;
}

/** What one delivery means for email designers: zero, one or a few notices, nothing about the payload kept beyond them. */
export function notifyEventsOf(event: string, payload: unknown, ctx: NotifyContext = {}): Notice[] {
  const p = obj(payload);
  const repoName = obj(p.repository).full_name;
  if (typeof repoName !== 'string' || !REPO_FULL.test(repoName)) return [];
  const repo = repoName.toLowerCase();
  const action = p.action;
  const sender = human(p.sender, ctx);

  if (event === 'issue_comment' && action === 'created') {
    const issue = obj(p.issue);
    const comment = obj(p.comment);
    // A comment on an open task (an issue), by a person, that is not Bridge's words for the designer.
    if (issue.pull_request || !Number.isSafeInteger(issue.number) || (issue.state !== undefined && issue.state !== 'open')) return [];
    const by = human(comment.user, ctx) ?? null;
    if (!by || !sender || typeof comment.body !== 'string' || !comment.body.trim() || bridgeWords(comment.body)) return [];
    const quote = quoteOf(comment.body);
    return [{ kind: 'question', repo, items: [issue.number], title: cleanTitle(issue.title), actor: by, copy: linkedCopy(issue.body, repo), scope: 'any', ...(quote ? { quote } : {}) }];
  }

  // The developers put needs-design on the task: they ask for design, with no words.
  if (event === 'issues' && action === 'labeled') {
    const issue = obj(p.issue);
    if (issue.pull_request || !Number.isSafeInteger(issue.number) || !sender || String(obj(p.label).name).toLowerCase() !== NEEDS_DESIGN_LABEL) return [];
    return [{ kind: 'question', repo, items: [issue.number], title: cleanTitle(issue.title), actor: sender, copy: linkedCopy(issue.body, repo), scope: 'any' }];
  }

  if (event === 'issues' && action === 'closed') {
    const issue = obj(p.issue);
    if (issue.pull_request || !Number.isSafeInteger(issue.number) || !sender) return [];
    const kind: NotifyKind = issue.state_reason === 'not_planned' || issue.state_reason === 'duplicate' ? 'declined' : 'shipped';
    return [{ kind, repo, items: [issue.number], title: cleanTitle(issue.title), actor: sender, copy: linkedCopy(issue.body, repo), scope: 'any' }];
  }

  if (event === 'pull_request') {
    const pr = obj(p.pull_request);
    if (!Number.isSafeInteger(pr.number)) return [];
    if (action === 'edited') {
      const from = obj(obj(p.changes).body).from;
      return typeof from === 'string' ? leadNoticesOf(from, pr.body, { repo, number: pr.number }) : [];
    }
    const closes = closedIssues(pr.body, repo);
    const author = human(pr.user, ctx) ?? (typeof obj(pr.user).login === 'string' ? { login: obj(pr.user).login as string, id: null } : null);
    // The developers' version, ready for a look: opened ready, or a draft marked ready. Bots count (a drafted change).
    if (((action === 'opened' && pr.draft !== true) || action === 'ready_for_review') && closes.length && author) {
      return [{ kind: 'look', repo, items: closes, title: cleanTitle(pr.title), actor: author, copy: null, scope: 'any' }];
    }
    if (action === 'closed' && pr.merged === true && closes.length && author) {
      return [{ kind: 'shipped', repo, items: closes, title: cleanTitle(pr.title), actor: sender ?? author, copy: null, scope: 'any' }];
    }
    // A library suggestion closed without being added, by a person (the designer closing their own goes through Bridge).
    if (action === 'closed' && pr.merged !== true && sender) {
      return [{ kind: 'suggestion-declined', repo, items: [pr.number], title: cleanTitle(pr.title), actor: sender, copy: null, scope: 'library' }];
    }
    return [];
  }

  if (event === 'pull_request_review' && action === 'submitted') {
    const pr = obj(p.pull_request);
    const review = obj(p.review);
    const by = human(review.user, ctx);
    if (!Number.isSafeInteger(pr.number) || !by || String(review.state).toLowerCase() !== 'changes_requested') return [];
    const quote = quoteOf(review.body);
    return [{ kind: 'changes', repo, items: [pr.number], title: cleanTitle(pr.title), actor: by, copy: null, scope: 'library', ...(quote ? { quote } : {}) }];
  }

  return [];
}
