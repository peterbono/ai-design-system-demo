// The exploration page while it runs (validated boards X1 "nothing built yet" and X2 "Claude has changed things"):
// pure view rules over @bridge-ds/core's exploration-resume words. Not started: the Continue in Claude panel and an
// empty "Your preview" frame. Exploring: the preview, the last activity in words, Done exploring, the last 3 events.
// Later states keep their own pages. No DOM, no fetch: tested in exploration-page.test.ts.
import { DEV_VERSION_READY, LIFECYCLE_LABEL, questionLine, type LifecycleStage } from './review-state';
import { changedThings, continueLines, explorationActivity, humanAuthorOf, parseExplorationBody, lastActivity, shortAgo, startedWhen, type BranchCommitLike, type PreviewApps } from '@bridge-ds/core';
import { emailMemberFace, isEmailAddress, nameFace } from './people';
import { isNameAuthor, nameOfAuthor } from './author';

/** A person or Claude on the page: the login (for the face), the name to show, and whether it is Claude. */
export interface PageFace {
  login: string;
  name: string;
  agent: boolean;
  avatar: string | null;
}

/** GitHub's public photo of an account (no API read); none for an email or Claude. */
export const avatarOf = (login: string): string | null => (/^[A-Za-z0-9-]+(\[bot\])?$/.test(login) && !/\[bot\]$/.test(login) ? `https://github.com/${login}.png?size=64` : null);

/**
 * The people a branch knows by name only: commit authors with no GitHub account behind them (an email member's saves
 * through Bridge, "Dino <...@contributors.bridge.invalid>"). Their name is never a login: no GitHub photo, no lookup.
 */
export function nameOnlyAuthors(commits: readonly BranchCommitLike[]): Set<string> {
  const out = new Set<string>();
  for (const c of commits) {
    const name = c.commit.author?.name?.trim();
    if (name && !c.author?.login) out.add(name);
  }
  return out;
}

/** The address Bridge gives an email member's saves: a person with no GitHub account, never linked to one. */
const MEMBER_EMAIL = /@contributors\.bridge\.invalid$/i;

/** GitHub's private address for an account ("63565173+peterbono@users.noreply.github.com"): its login. */
const noreplyLogin = (email: string): string | null => /^(?:\d+\+)?([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))@users\.noreply\.github\.com$/i.exec(email.trim())?.[1] ?? null;

/**
 * The branch's commits with their GitHub account filled in where GitHub left it out: a commit made with an address
 * the account has not verified (Florian's own address, pushed as peterbono) comes back with no author login, and would
 * read as someone known by name only (a drawn face, the email member's kind) instead of the person's photo. The login
 * comes from GitHub's private address when the commit has one, else from the same git name on the branch's other
 * commits when exactly one account carries it. An email member's saves (MEMBER_EMAIL), bots and Claude stay as they are.
 */
export function linkAuthors(commits: readonly BranchCommitLike[]): BranchCommitLike[] {
  const byName = new Map<string, Set<string>>();
  for (const c of commits) {
    const login = c.author?.login?.trim();
    const name = c.commit.author?.name?.trim().toLowerCase();
    if (login && name && humanAuthorOf(c) === login) byName.set(name, (byName.get(name) ?? new Set()).add(login));
  }
  return commits.map((c) => {
    if (c.author?.login?.trim()) return c;
    const name = c.commit.author?.name?.trim();
    const email = (c.commit.author as { email?: string | null } | null | undefined)?.email?.trim() ?? '';
    if (!name || MEMBER_EMAIL.test(email) || !humanAuthorOf(c) || /claude/i.test(name)) return c;
    const known = byName.get(name.toLowerCase());
    const login = noreplyLogin(email) ?? (known?.size === 1 ? [...known][0]! : null);
    return login ? { ...c, author: { ...c.author, login } } : c;
  });
}

/**
 * The face of an actor; a person's change Claude co-wrote reads "Florian with Claude" with the person's photo. Someone
 * known by name only (`nameOnly`, or an email address recorded as the author) gets the drawn face of their name, the
 * same one as on their cards and in the account menu (lib/people nameFace), never a GitHub account's photo.
 */
export const faceOf = (who: string, claude: boolean, names: Record<string, string> = {}, withClaude = false, nameOnly: ReadonlySet<string> = new Set()): PageFace => {
  if (claude) return { login: 'claude', name: 'Claude', agent: true, avatar: null };
  const tail = withClaude ? ' with Claude' : '';
  if (isEmailAddress(who)) {
    const name = names[who] ?? who.split('@')[0]!;
    return { login: emailMemberFace(names[who], who), name: `${name}${tail}`, agent: false, avatar: null };
  }
  if (isNameAuthor(who)) return { login: nameFace(nameOfAuthor(who)), name: `${names[who] ?? nameOfAuthor(who)}${tail}`, agent: false, avatar: null };
  if (nameOnly.has(who)) return { login: nameFace(who), name: `${names[who] ?? who}${tail}`, agent: false, avatar: null };
  return { login: who, name: `${names[who] ?? who}${tail}`, agent: false, avatar: avatarOf(who) };
};

/**
 * Display names readable without signing in: the git author name of each person's commits, when it is not the login
 * itself (or Claude). A signed-out visitor then reads "Florian", not "peterbono"; the login stays the fallback.
 */
export function gitNamesOf(commits: readonly BranchCommitLike[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of commits) {
    const login = c.author?.login?.trim();
    const name = c.commit.author?.name?.trim();
    if (!login || !name || out[login] || humanAuthorOf(c) !== login) continue;
    if (name.toLowerCase() !== login.toLowerCase() && !/claude/i.test(name)) out[login] = name;
  }
  return out;
}

/**
 * When an exploration was started: the time its Bridge block recorded (startedAt), else its pull request's creation,
 * else its first commit. The block comes first because the pull request can be opened again later (a repository moved
 * to another organization opens new pull requests for the same branches): its creation would then read after "said
 * done exploring" in the activity, and "Yesterday" for work started days ago.
 */
export function startedAtOf(body: string | null | undefined, createdAt: string | null | undefined, firstCommit?: string | null): string | null {
  const recorded = parseExplorationBody(body)?.startedAt;
  const valid = (iso: string | null | undefined) => (iso && !Number.isNaN(Date.parse(iso)) ? iso : null);
  return valid(recorded) ?? valid(createdAt) ?? valid(firstCommit) ?? null;
}

/** "Started by" line after the name: " · Admin demo · today". */
export const startedTail = (productName: string, startedAt: string | null | undefined, now?: Date): string => [productName, startedAt ? startedWhen(startedAt, now) : ''].filter(Boolean).join(' · ');

/** One row of the activity list, and the line under the title (the same words). */
export interface ActivityRow {
  who: PageFace;
  text: string;
  when: string;
}

/** The last 3 events: Claude's and people's changes, then "started the exploration" when it fits. */
export function activityRows(input: { commits: readonly BranchCommitLike[]; author: string; startedAt?: string | null | undefined; reopened?: { at: string; by?: string | null | undefined } | null; names?: Record<string, string>; now?: Date }): ActivityRow[] {
  const commits = linkAuthors(input.commits);
  return explorationActivity({ commits, author: input.author, startedAt: input.startedAt, reopened: input.reopened, limit: 3 }).map((e) => ({ who: faceOf(e.who, e.claude, input.names, e.withClaude, nameOnlyAuthors(commits)), text: e.text, when: shortAgo(e.at, input.now) }));
}

/** "Claude changed Orders table and Bulk actions bar, 2 h ago": the line under the title once something changed. */
export function headlineOf(input: { commits: readonly BranchCommitLike[]; files: readonly string[] | null; author: string; names?: Record<string, string>; now?: Date }): ActivityRow | null {
  const commits = linkAuthors(input.commits);
  const last = lastActivity({ commits, files: input.files, author: input.author });
  return last ? { who: faceOf(last.who, last.claude, input.names, last.withClaude, nameOnlyAuthors(commits)), text: last.text, when: shortAgo(last.at, input.now) } : null;
}

/** Back to exploring, from the exploration block: when, and who said it when known. */
export function reopenedOf(body: string | null | undefined): { at: string; by: string | null } | null {
  const e = parseExplorationBody(body);
  return e?.reopenedAt && !e.doneAt ? { at: e.reopenedAt, by: e.reopenedBy ?? null } : null;
}

/** The two lines of the Continue in Claude panel. */
export const pageLines = continueLines;

/**
 * Which preview a library exploration opens: the app its files change (the docs site, the admin demo), else the
 * Storybook for library components, else the docs site. Only apps the repository has previews for.
 */
export function libraryPreviewApp(files: readonly string[] | null | undefined, apps: PreviewApps): keyof PreviewApps | null {
  const has = (k: keyof PreviewApps) => Boolean(apps[k]);
  const f = files ?? [];
  if (f.some((x) => x.startsWith('apps/admin/')) && has('admin')) return 'admin';
  if (f.some((x) => x.startsWith('apps/docs-site/')) && has('docs')) return 'docs';
  if (f.some((x) => x.startsWith('packages/react/')) && has('storybook')) return 'storybook';
  return has('docs') ? 'docs' : has('storybook') ? 'storybook' : has('admin') ? 'admin' : null;
}

/** The Done exploring card: what its button does for this viewer (never a technical blocker). */
export type DoneAction = { kind: 'run' } | { kind: 'demo' } | { kind: 'note'; text: string } | null;

/**
 * Who sees the Done exploring card. A signed-out visitor or a viewer without write access to the repository (a PM, a
 * stakeholder) gets no card at all: they keep the preview, the line to continue and the activity. A signed-in person
 * with access who cannot keep it reads who can (`keeperNote`); the person who started it or a reviewer runs it.
 * `write`: null when unknown (a product's own repository), which leaves the decision to `keeper`.
 */
export function doneActionFor(v: { direct: boolean; demo: boolean; connected: boolean; write: boolean | null; keeper: boolean; keeperNote: string; productNote?: string | null }): DoneAction {
  if (!v.direct) return null;
  if (v.productNote) return { kind: 'note', text: v.productNote };
  if (!v.connected) return v.demo ? { kind: 'demo' } : null;
  if (v.write === false) return null;
  return v.keeper ? { kind: 'run' } : { kind: 'note', text: v.keeperNote };
}

/**
 * The "..." menu of the page, in order: Rename, Back to exploring, Archive. Only the keeper with GitHub in direct mode
 * (`writable`: the person who started it or a reviewer) gets it. Rename while it is open (not shipped). Back to
 * exploring only after Done exploring while no developer pushed since (status ready, not building). Nothing offered:
 * no menu at all.
 */
export function explorationMenu(v: { writable: boolean; status: string }): { rename: boolean; reopen: boolean; archive: boolean } {
  if (!v.writable) return { rename: false, reopen: false, archive: false };
  return { rename: v.status !== 'shipped', reopen: v.status === 'ready', archive: true };
}

// ---------------------------------------------------------------------------------------------------------------
// After Done exploring (Waiting for code, Being built, Shipped): the same page family as X1 and X2. The status tag,
// who said done and when, the preview, the hand-off in three steps, the pieces sent to the library, the activity.

/** The states of the page after Done exploring. */
export type HandoffStatus = 'ready' | 'building' | 'shipped';

/** True for the statuses this page shows after Done exploring. */
export const isHandoffStatus = (s: string): s is HandoffStatus => s === 'ready' || s === 'building' || s === 'shipped';

/** DS Badge tones the status tags use, the same words as the lists (core EXPLORATION_STATUS_LABEL). */
export type TagTone = 'neutral' | 'info' | 'success' | 'warning';

/**
 * The status tag of an exploration, everywhere it shows (the page title row, the Studio home cards): the same word
 * and the same tone. Not started is grey, Exploring is Harbor, Waiting for code waits on someone (amber), Being built
 * is in progress, Shipped is done.
 */
export function explorationTag(status: string, opts: { notStarted?: boolean; stage?: LifecycleStage | null } = {}): { label: string; tone: TagTone; dot: boolean } {
  // The lifecycle stage, once read (lib/review-state): Being built splits into In review, Shipped into In the next release.
  if (opts.stage === 'in-review') return { label: LIFECYCLE_LABEL['in-review'], tone: 'warning', dot: false };
  if (opts.stage === 'next-release') return { label: LIFECYCLE_LABEL['next-release'], tone: 'info', dot: false };
  // The designer said it looks right: the developers ship it next. Declined: grey, nothing moves.
  if (opts.stage === 'approved') return { label: LIFECYCLE_LABEL.approved, tone: 'info', dot: false };
  if (opts.stage === 'not-planned') return { label: LIFECYCLE_LABEL['not-planned'], tone: 'neutral', dot: false };
  if (status === 'active') return opts.notStarted ? { label: 'Not started', tone: 'neutral', dot: false } : { label: 'Exploring', tone: 'info', dot: true };
  if (status === 'ready') return { label: 'Waiting to be picked up', tone: 'warning', dot: false };
  if (status === 'building') return { label: 'Being built', tone: 'info', dot: true };
  if (status === 'shipped') return { label: 'Shipped', tone: 'success', dot: false };
  if (status === 'promoted') return { label: 'In review', tone: 'info', dot: false };
  if (status === 'kept') return { label: 'Kept in the library', tone: 'success', dot: false };
  return { label: 'Closed', tone: 'neutral', dot: false };
}

/** One row of the hand-off progress (the DS Checklist): done or waiting, a title, one line. */
export interface HandoffStep {
  /** warning: the developers wait on the designer (a question), or closed it without building it. */
  status: 'done' | 'waiting' | 'warning';
  title: string;
  detail: string;
  /** The step happening now (aria-current). */
  current?: boolean;
  /** One link on the row, when the step offers one (the viewer's review: compare with the exploration). */
  link?: { label: string; href: string } | null;
}

/** Bridge's own commit at Done exploring (the exploration note removed): neither the explorer's work nor a developer's. */
export const isDoneCommit = (c: BranchCommitLike): boolean => /^chore\(explore\): done exploring/.test(c.commit.message);

/** Who said Done exploring, from Bridge's commit at that moment (its author), when there is one. */
export function doneByOf(commits: readonly BranchCommitLike[]): string | null {
  const c = commits.find(isDoneCommit);
  return c ? humanAuthorOf(c) : null;
}

const names = (people: readonly PageFace[]) => (people.length <= 2 ? people.map((p) => p.name).join(' and ') : `${people[0]!.name} and ${people.length - 1} more`);

/** "Oct 30", "today", "yesterday": a day in words, for the hand-off steps. */
const dayOf = (iso: string | null | undefined, now?: Date): string => (iso ? startedWhen(iso, now) : '');

// The review reading (who is asked, each reviewer's last say) is shared by every page: lib/review-state.ts.
export { reviewersAsked, reviewVerdictOf, type PullReviewLike } from './review-state';

/**
 * The review of the developers' work, as the hand-off steps read it: still a draft (they are building), who is asked
 * to review (the requested reviewers, else the design approvers), the decision so far, the viewer, and the preview to
 * compare with the exploration.
 */
export interface HandoffReview {
  draft: boolean;
  asked: readonly PageFace[];
  verdict: { kind: 'approved' | 'changes'; by: PageFace } | null;
  viewer?: string | null;
  compareUrl?: string | null;
  /**
   * A design copy exploration: the developers' own pull request in their repository, its preview, and the designer's
   * last answer on it (posted by Bridge). The Review step reads it instead of the copy's reviews.
   */
  dev?: { url: string | null; answer: { kind: 'looks-right' | 'changes'; by: PageFace } | null } | null;
}

/**
 * The hand-off in four steps: Done exploring (who, when), Developers build it (waiting, or who builds it), Review (the
 * developers' work checked before it ships), Shipped. `builders`: the developers known on it (assigned, or who pushed
 * after Done exploring). `review`: read once the developers have started; without it, they are still building.
 */
export function handoffSteps(input: {
  status: HandoffStatus;
  doneBy: PageFace | null;
  doneAt: string | null;
  builders: readonly PageFace[];
  shippedAt?: string | null;
  product: string;
  library?: boolean;
  review?: HandoffReview | null;
  nextRelease?: boolean;
  /**
   * Someone asked the designer something on the task (lib/review-state devQuestionOf), answered or not: who asked
   * (`by`), and their part on the team when Bridge knows it (`role`, lib/review-state askerRole).
   */
  question?: { answered: boolean; by?: { name: string } | null; role?: string | null } | null;
  /** The developers closed their task without building it. */
  declined?: boolean;
  now?: Date;
}): HandoffStep[] {
  const when = dayOf(input.doneAt, input.now);
  // Say where the work went: Done exploring put it in the developers' task list.
  const sentTo = `Sent to the ${input.library ? 'library' : input.product} developers.`;
  const doneWho = [input.doneBy?.name, when].filter(Boolean).join(', ');
  const done: HandoffStep = { status: 'done', title: 'Done exploring', detail: doneWho ? `${doneWho}. ${sentTo}` : sentTo };
  const who = input.builders.length ? names(input.builders) : null;
  const rv = input.review ?? null;
  const dev = rv?.dev ?? null;
  // Building: still a draft (or nothing read yet), with no decision. Then the developers have asked for a review.
  const stage: 'ready' | 'building' | 'review' | 'changes' | 'approved' | 'shipped' =
    input.status === 'shipped'
      ? 'shipped'
      : input.status === 'ready'
        ? 'ready'
        : dev
          ? rv!.draft
            ? 'building'
            : dev.answer?.kind === 'looks-right'
              ? 'approved'
              : dev.answer?.kind === 'changes'
                ? 'changes'
                : 'review'
          : rv?.verdict?.kind === 'approved'
            ? 'approved'
            : rv?.verdict?.kind === 'changes'
              ? 'changes'
              : rv && !rv.draft
                ? 'review'
                : 'building';
  if (input.declined && stage !== 'shipped') {
    return [
      done,
      { status: 'warning', title: 'Developers build it', detail: DECLINED_LINE, current: true },
      { status: 'waiting', title: 'Review', detail: 'Not built' },
      { status: 'waiting', title: 'Shipped', detail: 'Not built' },
    ];
  }
  // A question the designer has not answered yet: the developers wait on them before they build on.
  const asks = Boolean(input.question && !input.question.answered) && (stage === 'ready' || stage === 'building');
  const build: HandoffStep = asks
    ? { status: 'warning', title: 'Developers build it', detail: questionLine(input.question!.by, input.question!.role), current: true }
    : stage === 'ready'
      ? { status: 'waiting', title: 'Developers build it', detail: who ? `Waiting for ${who}` : 'In their task list. You see here when one picks it up.', current: true }
      : stage === 'building'
        ? { status: 'waiting', title: 'Developers build it', detail: who ? `${who} ${input.builders.length === 1 ? 'is' : 'are'} building it` : 'Being built', current: true }
        : { status: 'done', title: 'Built', detail: who ? `By ${who}` : 'By your developers' };
  const review = ((): HandoffStep => {
    if (dev && stage !== 'ready' && stage !== 'building' && stage !== 'shipped') {
      const open = dev.url ? { link: { label: 'Open their version', href: dev.url } } : {};
      if (stage === 'approved') return { status: 'done', title: 'Reviewed', detail: `${dev.answer!.by.name} said it looks right`, ...open };
      if (stage === 'changes') return { status: 'waiting', title: 'Review', detail: `${dev.answer!.by.name} asked for changes`, current: true, ...open };
      return { status: 'waiting', title: 'Review', detail: DEV_VERSION_READY, current: true, ...open };
    }
    if (stage === 'ready') return { status: 'waiting', title: 'Review', detail: 'After the developers' };
    if (stage === 'building') return { status: 'waiting', title: 'Review', detail: 'When the developers ask' };
    if (stage === 'changes') return { status: 'waiting', title: 'Review', detail: `Changes requested by ${rv!.verdict!.by.name}`, current: true };
    if (stage === 'approved') return { status: 'done', title: 'Reviewed', detail: `Approved by ${rv!.verdict!.by.name}` };
    if (stage === 'shipped') {
      // A design copy exploration keeps who said it looks right on the developers' version (read once it shipped).
      if (dev?.answer?.kind === 'looks-right') return { status: 'done', title: 'Reviewed', detail: `${dev.answer.by.name} said it looks right` };
      return { status: 'done', title: 'Reviewed', detail: rv?.verdict?.kind === 'approved' ? `Approved by ${rv.verdict.by.name}` : 'Before it shipped' };
    }
    const viewer = rv?.viewer?.toLowerCase() ?? null;
    const asked = rv?.asked ?? [];
    if (viewer && asked.some((p) => p.login.toLowerCase() === viewer)) {
      return { status: 'waiting', title: 'Review', detail: 'Your review', current: true, ...(rv?.compareUrl ? { link: { label: 'Compare with the exploration', href: rv.compareUrl } } : {}) };
    }
    return { status: 'waiting', title: 'Review', detail: asked.length ? `Waiting for ${names(asked)}` : 'Waiting for a reviewer', current: true };
  })();
  const ship: HandoffStep =
    stage === 'shipped' && input.nextRelease
      ? { status: 'waiting', title: 'Shipped', detail: 'In the next release of the library', current: true }
      : stage === 'shipped'
      ? { status: 'done', title: 'Shipped', detail: [`In ${input.product}`, dayOf(input.shippedAt, input.now)].filter(Boolean).join(', '), current: true }
      : { status: 'waiting', title: 'Shipped', detail: `Then live in ${input.product}`, ...(stage === 'approved' ? { current: true } : {}) };
  return [done, build, review, ship];
}

/** The "Developers build it" step when they closed their task without building it (core's Not planned sentence). */
export const DECLINED_LINE = 'Developers closed it without building it.';
/**
 * The words around a question on the task, naming who asked (never "the developers" by default: a lead may ask). The
 * reply hint says where the answer goes in neutral words, the button and the sent line name the asker when known.
 */
export function questionWords(by: { name: string } | null | undefined): { hint: string; send: string; sent: string; answered: string; needsInput: string } {
  const name = by?.name?.trim() || null;
  const first = name?.split(/\s+/)[0] ?? null;
  return {
    hint: 'They read your answer where they work.',
    send: first ? `Send to ${first}` : 'Send your answer',
    sent: name ? `Sent to ${name}.` : 'Your answer is sent.',
    answered: 'Answered. The work goes on from here.',
    needsInput: 'Your input is needed before it is built.',
  };
}

/** How much of a quoted comment shows before "Show more". */
export const QUOTE_CLIP = 280;

/**
 * A quoted comment cut for the first look: whole when short, else cut at a word before `max` characters with an
 * ellipsis, and `clipped` so the page offers "Show more". Plain text in, plain text out.
 */
export function clipQuote(text: string, max = QUOTE_CLIP): { short: string; clipped: boolean } {
  const t = text.trim();
  if (t.length <= max) return { short: t, clipped: false };
  const cut = t.slice(0, max);
  const at = cut.lastIndexOf(' ');
  return { short: `${(at > max * 0.6 ? cut.slice(0, at) : cut).trimEnd()}…`, clipped: true };
}

/**
 * The developers known on it: the people assigned to it, then the people who pushed after Done exploring (not the
 * person who explored it, not Claude). Logins, deduplicated.
 */
export function buildersOf(input: { assignees?: readonly { login: string }[] | null; commits: readonly BranchCommitLike[]; doneAt: string | null; author: string }): string[] {
  const out: string[] = [];
  const add = (l: string | null | undefined) => {
    if (l && !/\[bot\]$/i.test(l) && l.toLowerCase() !== input.author.toLowerCase() && !out.some((x) => x.toLowerCase() === l.toLowerCase())) out.push(l);
  };
  for (const a of input.assignees ?? []) add(a.login);
  if (input.doneAt) {
    for (const c of input.commits) {
      if (isDoneCommit(c)) continue;
      const at = c.commit.author?.date ?? c.commit.committer?.date ?? '';
      if (at && at > input.doneAt && !/claude/i.test(c.author?.login ?? '') && !/claude/i.test(c.commit.author?.name ?? '')) add(c.author?.login ?? null);
    }
  }
  return out;
}

/**
 * The activity after Done exploring: "said done exploring" with the branch's events, newest first, the last 3. The
 * commit before it is the explorer's work, the ones after are the developers'.
 */
export function handoffActivity(input: { commits: readonly BranchCommitLike[]; author: string; startedAt?: string | null; doneBy: string | null; doneAt: string | null; designAnswer?: { kind: 'looks-right' | 'changes'; login: string; at: string } | null; names?: Record<string, string>; now?: Date }): ActivityRow[] {
  const commits = linkAuthors(input.commits);
  const events = explorationActivity({ commits: commits.filter((c) => !isDoneCommit(c)), author: input.author, startedAt: input.startedAt ?? null });
  const done = input.doneAt ? [...events, { who: input.doneBy ?? input.author, claude: false, text: 'said done exploring', at: input.doneAt }] : events;
  // The designer's answer on the developers' version (posted by Bridge on their pull request).
  const a = input.designAnswer;
  const all = a?.login && a.at ? [...done, { who: a.login, claude: false, text: a.kind === 'looks-right' ? 'said it looks right' : 'asked for changes', at: a.at }] : done;
  return all
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 3)
    .map((e) => ({ who: faceOf(e.who, e.claude, input.names, 'withClaude' in e && Boolean(e.withClaude), nameOnlyAuthors(commits)), text: e.text, when: shortAgo(e.at, input.now) }));
}

/** One piece the library gets from this exploration, with its request status. */
export interface SentPiece {
  id: string;
  title: string;
  /** Where it opens in Studio, when it has a library side. */
  href: string | null;
  /** "In review · Dana reviews", "Requested", or null with no library side yet. */
  line: string | null;
  tone: TagTone | 'danger';
  /** A token swatch, when the piece is a value. */
  value?: string | null;
  /** How Studio opens it in place (data-open-<opens>="<number>"), when it has a library side. */
  opens?: 'pr' | 'exploration' | 'request' | 'suggestion';
  number?: number;
  /** Its one action (send it to the library, use its preview, switch to the published version), when offered. */
  action?: { kind: 'open' | 'use-preview' | 'refresh-preview' | 'switch'; label: string } | null;
}

/**
 * What the hand-off card says about the library: the pieces (loading, being checked, the rows, nothing missing), or
 * not checked yet (with the way to check it in Claude when Bridge cannot run the check for this viewer).
 */
export type LibraryPieces =
  | { state: 'loading' }
  | { state: 'checking' }
  | { state: 'rows'; rows: SentPiece[] }
  | { state: 'none' }
  | { state: 'unchecked'; claude: string | null }
  | { state: 'hidden' };

/** A library exploration's requests (the library side it already has), as sent pieces. */
export function requestPieces(requests: readonly { number: number; title: string; component: string; statusLabel: string; open: boolean }[]): SentPiece[] {
  return requests.map((q) => ({ id: `request-${q.number}`, title: q.component || q.title, href: `?request=${q.number}`, line: q.statusLabel, tone: q.open ? 'info' : 'success', opens: 'request', number: q.number }));
}

/** The line to paste in Claude to check an exploration against the library, when Bridge cannot run it itself. */
export const checkInClaudeLine = (name: string, ref: string) => `Check what the exploration "${name}" (${ref}) adds that the library does not have, and record it in Bridge.`;

/** Where an app keeps its screens (pages, routes, screens, views, app, react-admin's resources): a file there is one. */
const SCREEN_FOLDER = /(^|\/)(pages|routes|screens|views|app|resources)\//;

/**
 * The screen a fallback preview names: the first changed file that is a screen (it sits in a screens folder), else
 * null, and the plate names the product alone. In a product, a changed component, a hook or a translation is no
 * screen: naming it would read as a guess. A library exploration explores its components: the first one changed.
 */
export function changedScreenOf(files: readonly string[] | null | undefined, opts: { library?: boolean } = {}): string | null {
  const all = files ?? [];
  return changedThings(all.filter((f) => SCREEN_FOLDER.test(f)))[0] ?? (opts.library ? (changedThings(all)[0] ?? null) : null);
}

/**
 * The Library route a library exploration's "See the library today" opens: the component it asks about (its first
 * request), else the Library home. libraryHref turns it into the team's address.
 */
export function libraryTodayRoute(component: string | null | undefined): string {
  const slug = (component ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug ? `components/${slug}/` : '';
}

/** The link beside an empty preview: the product as it is today, or the library for a library exploration. */
export const todayLinkLabel = (library: boolean): string => (library ? 'See the library today' : 'See the product today');

/**
 * Whether Studio runs the library check of an exploration on its own (api/mcp ?view=pieces): for someone who may write
 * it (who started it, a reviewer, or anyone with write access), in a team that writes branches, signed in with GitHub
 * or, in the design team's copy, as a member who joined by email (Bridge's server runs it with their Bridge session).
 */
export function canRunCheck(x: { github: boolean; emailInCopy: boolean; direct: boolean; emailOnProduct: boolean; keeper: boolean; write: boolean }): boolean {
  return (x.github || x.emailInCopy) && x.direct && !x.emailOnProduct && (x.keeper || x.write);
}
