// Team Branches (team shell /studio/<owner>/<repo>/changes/): the words and the addresses of the page, pure.
// scripts/team-branches.ts reads GitHub and routes; components/ds/studio/TeamSuggestions shows the suggestions.
import type { SuggestionKind, SuggestionListItem } from '@bridge-ds/core';
import type { ThumbSpec } from './branch-thumb';
import { shortTitle, statusBadge, type SuggestionTone } from './suggestions-view';

/** What opens in place on the page, from its address. A running exploration is a branch: it opens as one. */
export type TeamBranchesRoute = { view: 'list' } | { view: 'pr'; n: number } | { view: 'suggestion'; n: number };

export function teamBranchesRoute(search: string): TeamBranchesRoute {
  const p = new URLSearchParams(search);
  const num = (k: string) => {
    const n = Number(p.get(k));
    return Number.isInteger(n) && n > 0 ? n : 0;
  };
  if (num('suggestion')) return { view: 'suggestion', n: num('suggestion') };
  const pr = num('pr') || num('exploration');
  return pr ? { view: 'pr', n: pr } : { view: 'list' };
}

export interface SuggestionRow {
  number: number;
  title: string;
  author: string;
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
      thumb: (i.kind && KIND_THUMB[i.kind]) ?? { kind: 'icon', icon: 'token' },
      pill: statusBadge(i.status),
    }));
}
