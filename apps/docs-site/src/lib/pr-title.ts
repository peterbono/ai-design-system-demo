import { withoutJiraKey } from './vocabulary';

/**
 * A pull request title for people: a leading Jira key ("DS-42 ", shown apart in mono, lib/vocabulary jiraKeyOf) and
 * the conventional-commit prefix ("feat(card): ") go, the rest starts with a capital. "feat(card): lift interactive
 * cards on hover" reads "Lift interactive cards on hover".
 */
export function humanTitle(title: string): string {
  const rest = withoutJiraKey(title)
    .replace(/^[a-z]+(\([^)]*\))?!?:\s*/i, '')
    .trim();
  return rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : title;
}
