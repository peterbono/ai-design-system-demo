/**
 * A pull request title for people: the conventional-commit prefix ("feat(card): ") goes, the rest starts with a
 * capital. "feat(card): lift interactive cards on hover" reads "Lift interactive cards on hover".
 */
export function humanTitle(title: string): string {
  const rest = title.replace(/^[a-z]+(\([^)]*\))?!?:\s*/i, '').trim();
  return rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : title;
}
