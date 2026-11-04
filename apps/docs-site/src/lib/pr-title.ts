import { parseExplorationBody } from '@bridge-ds/core';
import { oneLineTitle } from './markdown';
import { withoutJiraKey } from './vocabulary';

/**
 * A pull request title for people: a leading Jira key ("DS-42 ", shown apart in mono, lib/vocabulary jiraKeyOf) and
 * the conventional-commit prefix ("feat(card): ") go, the rest starts with a capital. "feat(card): lift interactive
 * cards on hover" reads "Lift interactive cards on hover".
 */
export function humanTitle(title: string): string {
  const rest = withoutJiraKey(title)
    // A lowercase type ("feat:", "tokens:") or a known capitalized one ("Exploration:") goes; a component name keeps
    // its place: "Badge: overdue tone" (a product branch's missing piece) reads as it is.
    .replace(/^(?:[a-z]+|Exploration|Feat|Fix|Chore|Docs|Refactor|Revert|Tokens)(\([^)]*\))?!?:\s*/, '')
    .trim();
  return rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : title;
}

/**
 * An exploration's name, the one every screen shows (Home cards, product pages, Changes rows): the name in its
 * exploration block as the designer typed it ("Dashboard: orders waiting to ship"), else its pull request title for
 * people. The pull request title is only a fallback: it turns a colon in the name into a comma (core
 * explorationPrTitle), so reading it would show "Dashboard, orders waiting to ship" on one screen and the typed name
 * on another.
 */
export function explorationTitle(p: { title: string; body?: string | null | undefined }): string {
  const name = parseExplorationBody(p.body ?? null)?.name?.trim();
  if (name) return name.charAt(0).toUpperCase() + name.slice(1);
  return oneLineTitle(humanTitle(p.title));
}
