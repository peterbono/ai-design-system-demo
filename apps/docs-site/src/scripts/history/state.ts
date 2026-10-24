// History data in the browser: one fetch of /studio/versions/data.json per page, and the demo toggle. Real and demo
// reports stay separate; the toggle only picks which one a view shows, and every demo view carries a banner.
// On a team shell (multi-team PR 3b) there is no build-time history: it is read from GitHub with core
// loadGitHubHistory, lazily (only when a view asks), when signed in (it costs a few reads per change); a guest reads
// the history the team's CI published in activity.json (scripts/guest-activity.ts).
import { buildReport, gitHubHistoryBackend, layoutOptions, loadConfig, loadGitHubHistory, parseContrastChecks, requesterOf, type BridgeConfig, type ContrastPair, type GitHubClient, type HistoryEntry, type HistoryReport } from '@bridge-ds/core';
import { guidanceHistoryEntry, guidancePulls } from '../../lib/history-guidance';
import { reviewTokenChange, type TokenReview } from '../../lib/token-review';
import type { HistoryData } from '../../lib/history';
import { isHosted, studioHref } from '../../lib/team-path';
import { loadTeamData, teamClient } from '../team-data';
import { guestHistory } from '../guest-activity';
import { explorerConfig } from '../explorer/data';

/** Changes read from a team's repository: each costs a few GitHub reads (its pull request, its token files). */
export const TEAM_HISTORY_LIMIT = 20;
/**
 * A visitor who is not on the team, and the team's CI published no history: designer words, no GitHub. People on the
 * team read it, a GitHub sign-in or an email member alike (an email member's client reads through Bridge's server).
 */
export const TEAM_HISTORY_SIGN_IN = "The token history shows to the people on this team. Sign in to see it.";
/** Under a capped team history: where the older changes are. */
export const teamHistoryCapNote = (limit: number) => `The ${limit} latest token changes. Older ones are on GitHub.`;

let data: Promise<HistoryData> | null = null;

export function loadHistoryData(): Promise<HistoryData> {
  data ??= isHosted()
    ? teamHistoryData()
    : fetch(studioHref('versions/data.json')).then((r) => {
        if (!r.ok) throw new Error(`History data is missing (${r.status}). Rebuild the site.`);
        return r.json() as Promise<HistoryData>;
      });
  data.catch(() => (data = null));
  return data;
}

/** HistoryData for the team in the address, from its repo model and its GitHub history. */
async function teamHistoryData(): Promise<HistoryData> {
  const d = await loadTeamData();
  const config = explorerConfig(d.model, d);
  const empty = (source: HistoryReport['source']): HistoryReport => buildReport({ source, label: `${d.owner}/${d.repo}@${d.defaultBranch}`, ref: d.defaultBranch, entries: [], releases: [], truncated: false });
  const base = {
    generatedAt: new Date().toISOString(),
    config,
    files: d.model.tokens.files,
    checks: JSON.stringify({ pairs: d.model.contrast.specs.map((p) => ({ fg: p.fg, bg: p.bg, min: p.min })) }),
    demo: { ...empty('demo'), demo: true },
    reviews: {},
  };
  let client = d.client;
  if (!client.canWrite) {
    // A guest reads the history the team's CI published (activity.json), whatever its age: no API request.
    const real = await guestHistory();
    if (real) return { ...base, real, realNote: real.truncated ? teamHistoryCapNote(TEAM_HISTORY_LIMIT) : null };
    // A Bridge account on this team by email whose membership this page did not know yet: reading the account writes
    // it, then the history reads through Bridge's server like the rest of the Studio.
    try {
      const { getAccount } = await import('../account-session');
      await getAccount();
    } catch {
      /* no account, or Bridge cannot be reached */
    }
    client = teamClient(d);
    if (!client.canWrite) return { ...base, real: null, realNote: TEAM_HISTORY_SIGN_IN };
  }
  const tokens = await loadGitHubHistory(client, loadConfig(config), { ref: d.defaultBranch, limit: TEAM_HISTORY_LIMIT });
  const real = await withGuidance(tokens, client, d.defaultBranch);
  return { ...base, real, realNote: real.truncated ? teamHistoryCapNote(TEAM_HISTORY_LIMIT) : null };
}

/**
 * The token history with the usage guidance changes merged next to it (lib/history-guidance): one read of the recent
 * pull requests. GitHub refusing it leaves the token history as it is.
 */
async function withGuidance(report: HistoryReport, client: GitHubClient, base: string): Promise<HistoryReport> {
  const pulls = await client.listPullRequests('closed').catch(() => []);
  const known = new Set(report.entries.map((e) => e.pr?.number).filter((n): n is number => n !== undefined));
  const extra = guidancePulls(pulls, base, known).map((p) => {
    const r = requesterOf(p.body);
    return guidanceHistoryEntry(p, (r ? (r.name ?? r.login) : null) ?? p.author);
  });
  if (!extra.length) return report;
  const { timeline: _t, entries, ...rest } = report;
  return buildReport({ ...rest, entries: [...entries, ...extra] });
}

const teamReviews = new Map<string, Promise<TokenReview | null>>();

/**
 * The designer diff of one entry of a team's history, read on demand: the token files on each side of the change
 * (two trees, the changed bodies). The self-hosted build computes them all at build time; a team reads only the one
 * opened. Null for an import or a change without a parent.
 */
export function teamEntryReview(e: HistoryEntry, L: Loaded): Promise<TokenReview | null> {
  if (e.bulk || !e.baseSha) return Promise.resolve(null);
  let p = teamReviews.get(e.id);
  if (!p) {
    p = loadTeamData().then(async (d) => {
      const backend = gitHubHistoryBackend(d.client, L.config);
      const [before, after] = await Promise.all([backend.tokenFiles(e.baseSha!), backend.tokenFiles(e.sha)]);
      return reviewTokenChange(Object.fromEntries(before), Object.fromEntries(after), L.pairs, L.layout);
    });
    p.catch(() => teamReviews.delete(e.id));
    teamReviews.set(e.id, p);
  }
  return p;
}

export interface Loaded {
  data: HistoryData;
  config: BridgeConfig;
  pairs: ContrastPair[];
  layout: ReturnType<typeof layoutOptions>;
}

let loaded: Promise<Loaded> | null = null;
export function loadHistory(): Promise<Loaded> {
  loaded ??= loadHistoryData().then((d) => {
    const config = loadConfig(d.config);
    return { data: d, config, pairs: parseContrastChecks(d.checks || undefined), layout: layoutOptions(config) };
  });
  return loaded;
}

const KEY = 'bridge.history.demo';
export const DEMO_EVENT = 'bridge:history-demo';
/** Fixture history is for development only: a production build never shows it, whatever this browser saved. */
export const DEMO_AVAILABLE = (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV === true;

export function demoOn(): boolean {
  if (!DEMO_AVAILABLE) return false;
  try {
    return sessionStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function setDemo(on: boolean) {
  try {
    sessionStorage.setItem(KEY, on ? '1' : '');
  } catch {
    /* private mode: the toggle lives for this page */
  }
  document.dispatchEvent(new CustomEvent(DEMO_EVENT, { detail: on }));
}

/** The report a view shows: real by default, demo only when the toggle is on. */
export function activeReport(d: HistoryData): { report: HistoryReport | null; demo: boolean } {
  return demoOn() ? { report: d.demo, demo: true } : { report: d.real, demo: false };
}

export const DEMO_BANNER = "Demo data: fixture changes, not this repository's history.";
