/** Joins truthy class names. Kept local to avoid a runtime dependency. */
export function cx(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(' ');
}
