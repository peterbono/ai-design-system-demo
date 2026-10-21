// The demo's Studio home for a visitor (components/ds/studio/DemoHome.tsx): the rows it shows, from what GitHub says
// about the demo repository without an account (scripts/demo-home.ts reads it). Nothing here is "yours": rows say
// who waits for a review, never "waits on you", and nothing is made up. Pure, covered by demo-home.test.ts.
import { CLAUDE, ago, person, waitingLabel, type NeedRow, type Person } from './home-model';
import { oneLineTitle } from './markdown';
import { humanTitle } from './pr-title';
import { agentMade } from './work-nature';
import { suggestionHref, suggestionKey, shortTitle } from './suggestions-view';
import { studioHref } from './team-path';
import type { ThumbSpec } from './branch-thumb';

/** The fields of a pull request the demo home reads (GET /repos/{o}/{r}/pulls). */
export interface DemoPull {
  number: number;
  title: string;
  user: { login: string; avatar_url?: string; type?: string } | null;
  draft?: boolean;
  created_at: string;
  updated_at: string;
  merged_at?: string | null;
  body?: string | null;
  labels?: { name: string }[] | null;
  head?: { ref: string; sha?: string };
  base?: { ref: string; sha?: string };
}

/** The fields of a suggestion the demo home reads (GET /repos/{o}/{r}/issues?labels=bridge-suggestion). */
export interface DemoSuggestion {
  number: number;
  title: string;
  user: { login: string; avatar_url?: string } | null;
  created_at: string;
  pull_request?: unknown;
}

/** A pull request opened by automation (the release bot, Dependabot): not a design change. */
export const isBotPull = (p: Pick<DemoPull, 'user'>): boolean => !p.user || p.user.type === 'Bot' || /\[bot\]$|^app\//i.test(p.user.login);

const avatar = (u: { login: string; avatar_url?: string }) => u.avatar_url ?? `https://github.com/${u.login}.png?size=64`;

/** Who made a change: Claude AI for agent work, else the GitHub account. */
export function authorOf(p: Pick<DemoPull, 'user' | 'body' | 'labels'>): Person {
  if (agentMade({ body: p.body ?? null, labels: p.labels ?? null })) return CLAUDE;
  return p.user ? person(p.user.login, null, avatar(p.user)) : person('ghost', null, null);
}

const title = (t: string) => oneLineTitle(humanTitle(t));

/** One open branch waiting for a review, as a row: "Ann asks for a review", "Draft by Ann". */
export function demoPullRow(p: DemoPull, now: number, thumb?: ThumbSpec | null): NeedRow {
  const who = authorOf(p);
  const draft = Boolean(p.draft);
  return {
    key: `change-${p.number}`,
    kind: 'review',
    title: title(p.title),
    href: studioHref(`changes/?pr=${p.number}`),
    number: p.number,
    person: who,
    line: draft ? `Draft by ${who.name}` : `${who.name} asks for a review`,
    since: draft ? null : p.created_at,
    waitsOnYou: false,
    pill: draft ? { label: 'Draft', tone: 'neutral' } : { label: waitingLabel(p.created_at, now), tone: 'warning' },
    thumb: thumb ?? { kind: 'icon', icon: 'branch' },
  };
}

/** One suggestion waiting for a review, as a row. */
export function demoSuggestionRow(s: DemoSuggestion, now: number): NeedRow {
  const who = s.user ? person(s.user.login, null, avatar(s.user)) : person('ghost', null, null);
  return {
    key: suggestionKey(s.number),
    kind: 'review',
    title: shortTitle(s.title),
    href: suggestionHref(s.number),
    number: s.number,
    person: who,
    line: `${who.name} suggests a change`,
    since: s.created_at,
    waitsOnYou: false,
    pill: { label: waitingLabel(s.created_at, now), tone: 'warning' },
    thumb: { kind: 'icon', icon: 'token' },
  };
}

/**
 * Everything waiting for a review: ready branches and suggestions first (oldest first), drafts after them, automation
 * left out. Issues that are pull requests are left out of the suggestions.
 */
export function demoWaitingRows(pulls: DemoPull[], suggestions: DemoSuggestion[], now: number, thumbs: Map<number, ThumbSpec> = new Map()): NeedRow[] {
  const ready = pulls.filter((p) => !isBotPull(p));
  const rows = [
    ...ready.map((p) => demoPullRow(p, now, thumbs.get(p.number))),
    ...suggestions.filter((s) => !s.pull_request).map((s) => demoSuggestionRow(s, now)),
  ];
  const t = (r: NeedRow) => (r.since ? new Date(r.since).getTime() : Number.POSITIVE_INFINITY);
  return rows.sort((a, b) => t(a) - t(b));
}

/** One merged change, as a recent-changes row. */
export interface RecentChange {
  number: number;
  title: string;
  href: string;
  person: Person;
  line: string;
}

/** The latest merged changes, newest first, automation left out, at most `max`. */
export function recentChanges(closed: DemoPull[], now: number, max = 5): RecentChange[] {
  return closed
    .filter((p) => p.merged_at && !isBotPull(p))
    .sort((a, b) => b.merged_at!.localeCompare(a.merged_at!))
    .slice(0, max)
    .map((p) => {
      const who = authorOf(p);
      return { number: p.number, title: title(p.title), href: studioHref(`changes/?pr=${p.number}`), person: who, line: `Merged ${ago(p.merged_at!, now)} · ${who.name}` };
    });
}

/** The library figures of the demo home: counts and the two quality figures, each a link to where it comes from. */
export interface GlanceFigure {
  id: 'components' | 'tokens' | 'contrast' | 'adoption';
  value: string;
  label: string;
  href: string;
  /** Danger only when something fails. */
  tone: 'fail' | null;
}

const pct = (v: number) => `${Math.round(v * 10) / 10}%`;

/**
 * Components, tokens, contrast and adoption, in that order. Adoption is left out when no product was audited;
 * contrast when the repository names no checks.
 */
export function glanceFigures(x: { components: number; tokens: number; contrast: { total: number; fail: number } | null; adoption: number | null }): GlanceFigure[] {
  const out: GlanceFigure[] = [
    { id: 'components', value: String(x.components), label: x.components === 1 ? 'component' : 'components', href: studioHref('components/'), tone: null },
    { id: 'tokens', value: String(x.tokens), label: x.tokens === 1 ? 'token' : 'tokens', href: studioHref('tokens/'), tone: null },
  ];
  if (x.contrast && x.contrast.total) {
    // As Quality says it: every check passing, else how many fail.
    const fail = x.contrast.fail;
    out.push({ id: 'contrast', value: String(fail || x.contrast.total), label: fail ? `of ${x.contrast.total} contrast checks fail` : 'contrast checks pass', href: studioHref('quality/#ql-contrast'), tone: fail ? 'fail' : null });
  }
  if (x.adoption !== null) out.push({ id: 'adoption', value: pct(x.adoption), label: 'adoption in products', href: studioHref('quality/#ql-adoption'), tone: null });
  return out;
}
