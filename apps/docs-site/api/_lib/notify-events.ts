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
// Anything Bridge itself did for a member (the Bridge app's bot, a "(via Bridge)" comment) and anything another bot
// did is never news: the designer did it, or nobody did.

export type NotifyKind = 'question' | 'look' | 'changes' | 'declined' | 'shipped' | 'suggestion-declined';

/** The kinds that wait on the designer: sent right away by default. The others go in the daily summary. */
export const NEEDS_KINDS: ReadonlySet<NotifyKind> = new Set(['question', 'look', 'changes']);

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
// Studio's own words on a task (lib/review-state.ts devQuestionOf reads a question the same way; a test holds them
// equal): a design review the designer sent, taking the task back to exploring, and the label that asks for design.
export const DESIGN_REVIEW_PREFIX = 'Design review from Bridge:';
export const TASK_BACK_PREFIX = 'The design team took this back to exploring.';
export const NEEDS_DESIGN_LABEL = 'needs-design';
const bridgeWords = (body: string) => VIA_BRIDGE.test(body) || body.trim().startsWith(DESIGN_REVIEW_PREFIX) || body.trim().startsWith(TASK_BACK_PREFIX);

/** "Design: Pill buttons" (the task title Done exploring writes) as "Pill buttons"; any title cleaned and kept short. */
export function cleanTitle(raw: unknown): string {
  const t = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().replace(/^Design:\s*/i, '') : '';
  // No em dash in anything Bridge writes: one in a title becomes a comma.
  const s = t.replace(/\s*\u2014\s*/g, ', ');
  return s.length > 90 ? `${s.slice(0, 89).trimEnd()}…` : s;
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
    const r = m[1]!.toLowerCase();
    if (r !== repo && REPO_FULL.test(r)) return { repo: r, number: Number(m[2]) };
  }
  return null;
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
    return [{ kind: 'question', repo, items: [issue.number], title: cleanTitle(issue.title), actor: by, copy: linkedCopy(issue.body, repo), scope: 'any' }];
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
    return [{ kind: 'changes', repo, items: [pr.number], title: cleanTitle(pr.title), actor: by, copy: null, scope: 'library' }];
  }

  return [];
}
