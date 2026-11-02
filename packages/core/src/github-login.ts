// A GitHub login check (Enterprise managed users carry an underscore) for anything Bridge writes into GitHub content (a task, an exploration's note, a request).

/**
 * A GitHub login, or null for anything else (an email, a display name with spaces): a member's email never goes
 * into GitHub content, even when a caller passes one by mistake.
 */
export function githubLoginOf(s: string | null | undefined): string | null {
  const v = s?.trim().replace(/^@/, '') ?? '';
  return /^[A-Za-z0-9](?:[A-Za-z0-9_-]{0,38})$/.test(v) ? v : null;
}
