// Suggestions in the browser: what waits on the viewer (Home, the review queue and the nav badge read the same list,
// loadSuggestionNeeds), and one suggestion opened for review (Branches ?suggestion=N, and the review queue in place),
// painted by components/ds/studio/SuggestionReview. All GitHub calls go through the core with the viewer's own token
// (packages/core/src/suggestions-github.ts): list, read with the counted approvals, review (a comment bound to the
// version the viewer saw), decline. On open, the suggestion is also planned against today's main
// (planSuggestionApply, nothing written) to say whether it still applies and to re-run its checks.
// Words and rules: lib/suggestions-view.ts.
import {
  declineReasonProblems,
  declineSuggestionOnGitHub,
  getSuggestionOnGitHub,
  listSuggestionsOnGitHub,
  loadConfig,
  requesterOf,
  reviewSuggestionOnGitHub,
  stalenessStatus,
  suggestionStalenessOnGitHub,
  type ApprovalRole,
  type BridgeConfig,
  type GitHubClient,
  type PullRequestSummary,
  type Requester,
  type SuggestionDetail,
  type SuggestionListItem,
  type SuggestionStaleness,
  type SuggestionGovernance,
  type SuggestionStatus,
} from '@bridge-ds/core';
import { currentViewer, getToken, hasWorkingToken, initGitHubConnect, onAccess, prefersSignIn, readRepo, studioClient, ghGet } from './github-session';
import { loadTeams, siteApprovers, siteRoles, siteSoloOwner } from './teams';
import { ghAction } from '../lib/gh-wording';
import { person, requesterPerson, type NeedRow, type Person } from '../lib/home-model';
import {
  applyLines,
  approvalRows,
  approveLabel,
  declineAudience,
  kindLabel,
  missingRoles,
  proofChips,
  reviewedLine,
  shortTitle,
  staleLines,
  statusBadge,
  suggestionGate,
  suggestionNeed,
  suggestionThumb,
  tokenRows,
  waitsOnViewer,
  type TodayChecks,
} from '../lib/suggestions-view';
import type { DeclineAskDetail } from '../components/ds/studio/RequestDecide';
import type { SuggestionReviewProps, NextCard } from '../components/ds/studio/SuggestionReview';

/** RequestDecide's DECLINE_EVENT, spelled here so the shell (the nav badge) does not load the dialog's code. */
const DECLINE_EVENT = 'bridge:request-decline';

// Read when used, never at import: server-rendered pages import this module through scripts/home-data.ts.
const repoKey = () => {
  const r = readRepo();
  return `${r.owner}/${r.repo}`;
};
const client = (): GitHubClient => studioClient(repoKey(), getToken() ?? '');

let write = false;
onAccess((a) => (write = Boolean(a?.write)));

/** Owners and rights as the layout embeds them (bridge.config.json on the default branch), teams once read. */
async function governance(): Promise<SuggestionGovernance> {
  const { owners, rights, soloOwnerCanApproveBoth } = siteRoles();
  return { owners, rights, teams: await loadTeams(), soloOwnerCanApproveBoth };
}

// ---------------------------------------------------------------------------------------------------------------
// What waits on the viewer: one list for Home, the queue and the badge

const NEEDS_KEY = 'bridge.suggestions.needs.v2';
const NEEDS_TTL = 2 * 60 * 1000;
const MAX_READ = 20;

interface Waiting {
  number: number;
  title: string;
  author: string;
  createdAt: string;
  thumb: NeedRow['thumb'];
  /** The issue labels (its kind, a product): Branches > Waiting on me sorts by them. */
  labels?: string[];
  /** Who asked for it, as Bridge records it in the body ("Requested by Ann Leroy."). */
  requester?: Requester | null;
}

let needs: { viewer: string; at: number; rows: Promise<Waiting[]> } | null = null;

/** Forget what was read (after a review here, or when the viewer changes). */
export function forgetSuggestions() {
  needs = null;
  try {
    sessionStorage.removeItem(NEEDS_KEY);
  } catch {
    /* private mode */
  }
}

if (typeof document !== 'undefined') document.addEventListener('bridge:auth', forgetSuggestions);

async function readWaiting(viewer: string): Promise<Waiting[]> {
  const gh = client();
  const pulls = await gh.listPullRequests('all').catch(() => [] as PullRequestSummary[]);
  const items = await listSuggestionsOnGitHub(gh, { state: 'open', pulls });
  const gov = await governance();
  const owners = siteApprovers();
  // The label is a cache: only the ones it says need a review, by someone else, are read for their real approvals.
  const maybe = items.filter((i) => waitsOnViewer({ status: i.status, missing: [], viewer, author: i.author, owners, collaborator: write })).slice(0, MAX_READ);
  const read = await Promise.all(
    maybe.map(async (i): Promise<Waiting | null> => {
      try {
        const d = await getSuggestionOnGitHub(gh, i.number, gov, { pulls });
        if (!d.parsed.ok) return null;
        const tier = d.parsed.payload.tier.tier;
        const reviewed = [...(d.approvals?.approvers ?? []), ...(d.approvals?.changesRequested ?? [])].some((l) => l.toLowerCase() === viewer.toLowerCase());
        // An outdated one waits on its author to send it again, not on a review (the status its page shows).
        const stale = await stalenessOnMain(gh, d);
        if (!waitsOnViewer({ status: stalenessStatus(d.status, stale), missing: missingRoles(tier, d.approvals), viewer, author: d.issue.author, owners, collaborator: write, reviewed })) return null;
        return {
          number: i.number,
          title: shortTitle(d.parsed.payload.title || i.title),
          author: d.issue.author,
          createdAt: d.issue.createdAt,
          thumb: suggestionThumb(d.parsed.payload, theme()),
          labels: d.issue.labels,
          requester: requesterOf(d.issue.body),
        };
      } catch {
        return null;
      }
    }),
  );
  return read.filter((x): x is Waiting => x !== null);
}

/**
 * The suggestions that wait on the signed-in viewer, as Home and queue rows. Read once per page and kept two
 * minutes in this browser, so Home, the queue and the badge agree. Empty signed out or when GitHub cannot be read.
 */
export async function loadSuggestionNeeds(personOf: (login: string) => Promise<Person> = async (l) => person(l, null, `https://github.com/${l}.png?size=64`)): Promise<NeedRow[]> {
  const now = Date.now();
  const rows = await readNeeds();
  return Promise.all(rows.map(async (w) => suggestionNeed(w, await personOf(w.author), now)));
}

/**
 * The same suggestions for Branches > Waiting on me: each row names who asked for it (the requester, else the
 * author) and keeps the issue labels, which say its kind and product.
 */
export async function loadSuggestionQueue(personOf: (login: string) => Promise<Person> = async (l) => person(l, null, `https://github.com/${l}.png?size=64`)): Promise<{ need: NeedRow; labels: string[] }[]> {
  const now = Date.now();
  const rows = await readNeeds();
  return Promise.all(
    rows.map(async (w) => {
      const asker = (w.requester && requesterPerson(w.requester, (l) => person(l, null, `https://github.com/${l}.png?size=64`))) ?? (await personOf(w.author));
      return { need: { ...suggestionNeed(w, asker, now), number: w.number }, labels: w.labels ?? [] };
    }),
  );
}

/** What waits on the signed-in viewer, read once per page and kept two minutes. Empty signed out. */
async function readNeeds(): Promise<Waiting[]> {
  const viewer = currentViewer()?.login ?? null;
  if (!viewer || !hasWorkingToken()) return [];
  if (!needs || needs.viewer !== viewer || Date.now() - needs.at > NEEDS_TTL) {
    let cached: Waiting[] | null = null;
    try {
      const raw = JSON.parse(sessionStorage.getItem(NEEDS_KEY) || 'null') as { viewer: string; at: number; rows: Waiting[] } | null;
      if (raw && raw.viewer === viewer && Date.now() - raw.at < NEEDS_TTL) cached = raw.rows;
    } catch {
      /* no cache */
    }
    const at = Date.now();
    const rows = cached
      ? Promise.resolve(cached)
      : readWaiting(viewer).then((r) => {
          try {
            sessionStorage.setItem(NEEDS_KEY, JSON.stringify({ viewer, at, rows: r }));
          } catch {
            /* quota */
          }
          return r;
        });
    needs = { viewer, at, rows: rows.catch(() => [] as Waiting[]) };
  }
  return needs.rows;
}

// ---------------------------------------------------------------------------------------------------------------
// One suggestion: read, plan against today's main, paint

const theme = (): 'light' | 'dark' => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');

const names = new Map<string, Promise<string>>();
/** A display name for a login (GitHub profile name), read once per page. */
function nameOf(login: string): Promise<string> {
  const k = login.toLowerCase();
  let p = names.get(k);
  if (!p) {
    p = ghGet<{ name?: string | null }>(`/users/${encodeURIComponent(login)}`)
      .then((f) => f.data.name?.trim() || login)
      .catch(() => login);
    names.set(k, p);
  }
  return p;
}

let config: Promise<BridgeConfig | null> | null = null;
/** bridge.config.json as main has it (the planner needs the token layout and the contrast checks file). */
function mainConfig(gh: GitHubClient): Promise<BridgeConfig | null> {
  config ??= gh
    .getFileText('bridge.config.json')
    .then((t) => (t ? loadConfig(t) : null))
    .catch(() => null);
  return config;
}

/**
 * Whether an open suggestion still applies to today's main (core suggestionStalenessOnGitHub, the rule the MCP server
 * and the CLI use): nothing read when main has not moved, the dry run (planSuggestionApply, nothing written) when main
 * changed what it writes. Null when it is not open, not in review, or main cannot be read.
 */
async function stalenessOnMain(gh: GitHubClient, d: SuggestionDetail): Promise<SuggestionStaleness | null> {
  if (!d.parsed.ok || d.issue.state !== 'open') return null;
  if (d.status !== 'needs-review' && d.status !== 'changes-requested' && d.status !== 'approved') return null;
  const cfg = await mainConfig(gh);
  if (!cfg) return null;
  return suggestionStalenessOnGitHub(gh, d, { config: cfg, governance: await governance(), ref: d.parsed.payload.base.ref || readRepo().defaultBranch }).catch(() => null);
}

/**
 * The open suggestions of a list that main made outdated, read with a working token only (anonymous visitors keep
 * their GitHub reads for the branches). At most `limit`, newest first.
 */
export async function outdatedOf(items: readonly SuggestionListItem[], gh: GitHubClient = client(), limit = 10): Promise<Set<number>> {
  const out = new Set<number>();
  if (!hasWorkingToken()) return out;
  const open = items.filter((i) => i.state === 'open' && (i.status === 'needs-review' || i.status === 'changes-requested' || i.status === 'approved')).slice(0, limit);
  if (!open.length) return out;
  const gov = await governance();
  await Promise.all(
    open.map(async (i) => {
      const d = await getSuggestionOnGitHub(gh, i.number, gov).catch(() => null);
      const st = d ? await stalenessOnMain(gh, d) : null;
      if (st?.outdated) out.add(i.number);
    }),
  );
  return out;
}

export interface OpenedSuggestion {
  number: number;
  title: string;
  sha: string;
  role: ApprovalRole | null;
  status: SuggestionStatus;
  canApprove: boolean;
  canRequestChanges: boolean;
}

export interface SuggestionHost {
  /** Where the review paints. */
  el: HTMLElement;
  /** Inside the review queue: the queue's own list and keys; the stacked cards are the next rows. */
  inQueue?: boolean;
  next?: NextCard[];
  crumbs?: { label: string; href?: string }[];
  /**
   * Approve, as the queue does it (an Undo window before it is sent). Absent: sent at once. `send` posts the review.
   */
  approve?: (s: OpenedSuggestion, send: () => Promise<void>) => void;
  /** After a decision went through. */
  decided?: (s: OpenedSuggestion, event: 'approve' | 'request-changes' | 'decline', line: string) => void;
  /** What the open suggestion allows, each time it is painted. */
  opened?: (s: OpenedSuggestion | null) => void;
}

type Paint = (el: HTMLElement, props: SuggestionReviewProps | { loading: true; crumbs?: SuggestionHost['crumbs'] } | { error: string; crumbs?: SuggestionHost['crumbs']; url: string }) => void;
let ui: Promise<{ paint: Paint; unmount: (el: HTMLElement) => void }> | null = null;
const loadUi = () => (ui ??= import('../components/ds/studio/SuggestionReview').then((m) => ({ paint: m.paintSuggestionReview, unmount: m.unmountSuggestionReview })));

let seq = 0;

/** Closes the suggestion painted in `el`, if any. */
export function closeSuggestion(el: HTMLElement | null) {
  seq++;
  if (!el) return;
  void loadUi().then((m) => m.unmount(el));
  el.hidden = true;
}

/**
 * Opens suggestion `n` in `host.el`: the decide card at once from the issue, then today's re-run of its checks and
 * whether main moved under it. Repaints after each decision.
 */
export async function openSuggestion(n: number, host: SuggestionHost): Promise<void> {
  const mine = ++seq;
  const { paint } = await loadUi();
  const el = host.el;
  el.hidden = false;
  paint(el, { loading: true, crumbs: host.crumbs });
  host.opened?.(null);
  const url = `https://github.com/${repoKey()}/issues/${n}`;
  const gh = client();
  let d: SuggestionDetail;
  try {
    d = await getSuggestionOnGitHub(gh, n, await governance());
  } catch (err) {
    if (mine !== seq) return;
    const why = (err as { status?: number }).status === 404 ? `#${n} was not found in ${repoKey()}.` : `GitHub could not be read: ${(err as Error).message}`;
    paint(el, { error: why, crumbs: host.crumbs, url });
    return;
  }
  if (mine !== seq) return;
  if (!d.parsed.ok) {
    paint(el, { error: `#${n} is not a suggestion Bridge can read: ${d.parsed.message}`, crumbs: host.crumbs, url });
    return;
  }
  const payload = d.parsed.payload;
  const sha = d.parsed.sha;
  const viewer = currentViewer()?.login ?? null;
  const owners = siteApprovers();
  const logins = [d.issue.author, ...(d.approvals?.stale ?? []), ...(d.approvals?.approvers ?? []), ...(d.approvals?.changesRequested ?? []), ...owners.design, ...owners.tech];
  const nameMap: Record<string, string> = {};
  await Promise.all([...new Set(logins.map((l) => l.toLowerCase()))].map(async (l) => (nameMap[l] = await nameOf(l))));
  if (mine !== seq) return;
  const title = shortTitle(payload.title || d.issue.title);
  let today: TodayChecks | null = null;
  let conflicts: { path: string; detail: string; now?: unknown }[] | undefined;
  let mainMoved = false;
  let status: SuggestionStatus = d.status;

  const render = (said?: string) => {
    if (mine !== seq) return;
    const gate = suggestionGate({ status, viewer, author: d.issue.author, owners, tier: payload.tier.tier, approvals: d.approvals, collaborator: write, names: nameMap, signInLine: ghAction('review', prefersSignIn()), soloOwner: siteSoloOwner() });
    const opened: OpenedSuggestion = { number: n, title, sha, role: gate.role, status, canApprove: gate.canApprove, canRequestChanges: gate.canRequestChanges };
    const props: SuggestionReviewProps = {
      n,
      url,
      title,
      kind: kindLabel(payload.kind),
      summary: payload.summary,
      author: { login: d.issue.author, name: nameMap[d.issue.author.toLowerCase()] ?? d.issue.author, avatarUrl: `https://github.com/${d.issue.author}.png?size=64`, agent: payload.source === 'mcp' && /claude/i.test(d.issue.author) },
      source: payload.source,
      createdAt: d.issue.createdAt,
      status: statusBadge(status),
      tokens: tokenRows(payload),
      docs: (payload.docs ?? []).map((x) => ({ component: x.component, after: x.after })),
      spec: payload.componentSpec ? { component: payload.componentSpec.component, brief: payload.componentSpec.brief } : null,
      files: (payload.files ?? []).filter((f) => !f.path.startsWith('.changeset/')).map((f) => f.path),
      proofs: proofChips(payload, today),
      proofsWhen: today ? 'today' : conflicts === undefined && hasWorkingToken() ? 'checking' : 'suggested',
      stale: staleLines({ stale: d.approvals?.stale ?? [], names: nameMap, mainMoved, conflicts }),
      edited: d.parsed.ok && d.parsed.edited,
      approvals: approvalRows({ tier: payload.tier.tier, approvals: d.approvals, owners, names: nameMap }),
      gate,
      approveLabel: approveLabel(gate, payload.tier.tier),
      apply: status === 'approved' ? applyLines(n) : null,
      previews: payload.previews ?? [],
      next: host.next ?? [],
      crumbs: host.crumbs,
      inQueue: Boolean(host.inQueue),
      said,
      onApprove: (text: string) => approve(text),
      onRequestChanges: (text: string) => review('request-changes', text),
      onDecline: () => decline(),
    };
    paint(el, props);
    host.opened?.(opened);
  };

  const refresh = async () => {
    const next = await getSuggestionOnGitHub(gh, n, await governance());
    if (next.parsed.ok) d = next;
    status = stalenessStatus(d.status, { outdated: Boolean(conflicts?.length) });
  };

  const review = async (event: 'approve' | 'request-changes', text: string): Promise<string> => {
    const role = suggestionGate({ status, viewer, author: d.issue.author, owners, tier: payload.tier.tier, approvals: d.approvals, collaborator: write, signInLine: '', soloOwner: siteSoloOwner() }).role;
    const r = await reviewSuggestionOnGitHub(gh, n, { event, role: event === 'approve' ? (role ?? undefined) : undefined, message: text || undefined, payloadSha: sha, by: viewer ?? undefined }, await governance());
    forgetSuggestions();
    await refresh();
    const line = [reviewedLine(event, title, r.status), ...r.warnings].join(' ');
    render(line);
    host.decided?.({ number: n, title, sha, role, status, canApprove: false, canRequestChanges: false }, event, line);
    return line;
  };

  const approve = async (text: string): Promise<string | void> => {
    if (host.approve) {
      host.approve({ number: n, title, sha, role: null, status, canApprove: true, canRequestChanges: true }, async () => {
        await review('approve', text);
      });
      return;
    }
    return review('approve', text);
  };

  const decline = () => {
    const detail: DeclineAskDetail = {
      number: n,
      title,
      audience: declineAudience(d.issue.author, nameMap),
      problems: declineReasonProblems,
      confirm: async (reason) => {
        const r = await declineSuggestionOnGitHub(gh, n, reason, viewer);
        forgetSuggestions();
        status = 'declined';
        const line = [reviewedLine('decline', title), ...r.warnings].join(' ');
        render(line);
        host.decided?.({ number: n, title, sha, role: null, status, canApprove: false, canRequestChanges: false }, 'decline', line);
      },
      closed: () => undefined,
      noun: 'suggestion',
    };
    document.dispatchEvent(new CustomEvent(DECLINE_EVENT, { detail }));
  };

  render();
  if (!hasWorkingToken() || d.issue.state === 'closed') return;
  // Today's main (core staleness, the rule the MCP server and the CLI use): the card says whether it still applies.
  try {
    const r = await stalenessOnMain(gh, d);
    if (mine !== seq) return;
    mainMoved = Boolean(r?.mainMoved);
    conflicts = r?.conflicts ?? [];
    const c = r?.plan?.checks;
    today = c ? { newErrors: c.newErrors.length, newFailures: c.newFailures.map((f) => ({ pair: `${f.fg} on ${f.bg}`, mode: f.modes })) } : null;
    status = stalenessStatus(status, r);
  } catch {
    conflicts = conflicts ?? [];
  }
  render();
}

/** Repaint the open suggestion when the viewer changes: what they may do depends on who is connected. */
export function onViewerChange(fn: () => void) {
  let last: string | null | undefined;
  initGitHubConnect((v) => {
    const login = v?.login ?? null;
    if (last !== undefined && login !== last) {
      forgetSuggestions();
      fn();
    }
    last = login;
  });
}
