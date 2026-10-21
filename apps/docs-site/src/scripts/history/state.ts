// History data in the browser: one fetch of /studio/versions/data.json per page, and the demo toggle. Real and demo
// reports stay separate; the toggle only picks which one a view shows, and every demo view carries a banner.
// On a team shell (multi-team PR 3b) there is no build-time history: it is read from GitHub with core
// loadGitHubHistory, lazily (only when a view asks), when signed in (it costs a few reads per change); a guest reads
// the history the team's CI published in activity.json (scripts/guest-activity.ts).
import { buildReport, gitHubHistoryBackend, layoutOptions, loadConfig, loadGitHubHistory, parseContrastChecks, type BridgeConfig, type ContrastPair, type HistoryEntry, type HistoryReport } from '@bridge-ds/core';
import { reviewTokenChange, type TokenReview } from '../../lib/token-review';
import type { HistoryData } from '../../lib/history';
import { isHosted, studioHref } from '../../lib/team-path';
import { loadTeamData } from '../team-data';
import { guestHistory } from '../guest-activity';
import { explorerConfig } from '../explorer/data';

/** Changes read from a team's repository: each costs a few GitHub reads (its pull request, its token files). */
export const TEAM_HISTORY_LIMIT = 20;
export const TEAM_HISTORY_SIGN_IN = "Sign in with GitHub to see this repository's token history. Reading it takes more GitHub requests than a visit without signing in allows.";
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
  if (!d.client.canWrite) {
    // A guest reads the history the team's CI published (activity.json), whatever its age: no API request.
    const real = await guestHistory();
    return real ? { ...base, real, realNote: real.truncated ? teamHistoryCapNote(TEAM_HISTORY_LIMIT) : null } : { ...base, real: null, realNote: TEAM_HISTORY_SIGN_IN };
  }
  const real = await loadGitHubHistory(d.client, loadConfig(config), { ref: d.defaultBranch, limit: TEAM_HISTORY_LIMIT });
  return { ...base, real, realNote: real.truncated ? teamHistoryCapNote(TEAM_HISTORY_LIMIT) : null };
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
