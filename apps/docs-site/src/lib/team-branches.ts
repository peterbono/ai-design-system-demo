// Team Branches (team shell /studio/<owner>/<repo>/changes/): the words and the addresses of the page, pure.
// scripts/team-branches.ts reads GitHub and routes; components/ds/studio/TeamSuggestions shows the suggestions.
import type { Requester, SuggestionKind, SuggestionListItem } from '@bridge-ds/core';
import type { ThumbSpec } from './branch-thumb';
import { shortTitle, statusBadge, type SuggestionTone } from './suggestions-view';
import { REQUEST_TRIAGE_IN_STUDIO } from './studio-flags';

/**
 * What the page shows, from its address, with the same rules as the self-hosted Branches page (scripts/changes.ts):
 * a branch, a suggestion or a component change request in place; the old History (?view=history), which moved
 * (lib/history-moved: the page redirects before it routes); the exploration start form
 * (?view=explorations with &start=new or &for=<request>); Requests (?view=requests) only when request triage is on in
 * Studio. Anything else is the list. A running exploration is a branch: it opens as one.
 */
export type TeamBranchesRoute =
  | { view: 'list' }
  | { view: 'pr'; n: number }
  /** An exploration in a product's own repository (&product=<key>): it opens on the exploration page, not as a branch here. */
  | { view: 'exploration'; n: number; product: string }
  | { view: 'suggestion'; n: number }
  | { view: 'request'; n: number }
  | { view: 'requests' }
  | { view: 'explorations'; forRequest: number | null };

export function teamBranchesRoute(search: string, requestTriage: boolean = REQUEST_TRIAGE_IN_STUDIO): TeamBranchesRoute {
  const p = new URLSearchParams(search);
  const num = (k: string) => {
    const n = Number(p.get(k));
    return Number.isInteger(n) && n > 0 ? n : 0;
  };
  if (num('suggestion')) return { view: 'suggestion', n: num('suggestion') };
  const product = p.get('product')?.trim().toLowerCase();
  if (num('exploration') && product && /^[a-z0-9][a-z0-9-]*$/.test(product)) return { view: 'exploration', n: num('exploration'), product };
  const pr = num('pr') || num('exploration');
  if (pr) return { view: 'pr', n: pr };
  if (num('request')) return { view: 'request', n: num('request') };
  const v = p.get('view');
  if (v === 'requests' && requestTriage) return { view: 'requests' };
  if (v === 'explorations' && (num('for') || p.get('start') === 'new')) return { view: 'explorations', forRequest: num('for') || null };
  return { view: 'list' };
}

/** The page title per view, as on the self-hosted page. */
export const TEAM_VIEW_TITLE = { list: 'Changes', requests: 'Requests', explorations: 'Explorations' } as const;

export interface SuggestionRow {
  number: number;
  title: string;
  author: string;
  /** Who asked for it ("Requested by Ann Leroy." in the body), shown instead of the author when there is one. */
  requester: Requester | null;
  thumb: ThumbSpec;
  pill: { label: string; tone: SuggestionTone };
}

const KIND_THUMB: Partial<Record<SuggestionKind, ThumbSpec>> = {
  docs: { kind: 'icon', icon: 'guidance' },
  'component-spec': { kind: 'icon', icon: 'component' },
};

/** Open suggestions as rows next to the branches, newest first. Closed ones stay on GitHub. */
export function suggestionRows(items: readonly SuggestionListItem[]): SuggestionRow[] {
  return items
    .filter((i) => i.state === 'open')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((i) => ({
      number: i.number,
      title: shortTitle(i.title),
      author: i.author,
      requester: i.requester ?? null,
      thumb: (i.kind && KIND_THUMB[i.kind]) ?? { kind: 'icon', icon: 'token' },
      pill: statusBadge(i.status),
    }));
}
