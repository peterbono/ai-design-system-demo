// The role a Bridge account's linked GitHub account has on this page's team, for a browser that holds no GitHub
// sign-in (signed in with the email code, or the GitHub sign-in ran out here). The server reads it with the Bridge app
// and matches the GitHub id (GET /api/entry?linked=, scripts/entry-session.ts), so the team page shows the person's
// real role and asks them to reconnect GitHub to make changes (lib/linked-role.ts), never the visitor's read-only view.
// Read once per page and team; nothing here grants anything: every write still needs the person's own GitHub sign-in,
// and the server checks it again.
import type { LinkedRole } from '../lib/linked-role';

let current: { repo: string; role: LinkedRole | null } | null = null;
let pending: { repo: string; run: Promise<LinkedRole | null> } | null = null;
const subs: ((role: LinkedRole | null) => void)[] = [];

/** The role read for `repo` on this page, null until read (or when there is none). */
export function linkedRole(repo: string): LinkedRole | null {
  return current && current.repo === repo.toLowerCase() ? current.role : null;
}

/** Calls `fn` each time the role is read; at once when it is known already. */
export function onLinkedRole(fn: (role: LinkedRole | null) => void): void {
  subs.push(fn);
  if (current) fn(current.role);
}

/**
 * Reads the role once for `repo`: only with a Bridge account whose GitHub is linked (no call otherwise). Tests pass
 * their own `deps`.
 */
export function readLinkedRole(
  repo: string,
  deps: { account?: () => Promise<{ github: unknown; teams?: { repo: string }[] } | null>; role?: (repo: string) => Promise<LinkedRole | null>; refresh?: () => Promise<unknown> } = {},
): Promise<LinkedRole | null> {
  const key = repo.toLowerCase();
  if (current?.repo === key) return Promise.resolve(current.role);
  if (pending?.repo === key) return pending.run;
  const account =
    deps.account ??
    (async () => {
      const { getAccount } = await import('./account-session');
      return (await getAccount().catch(() => ({ account: null }))).account;
    });
  const role =
    deps.role ??
    (async (r: string) => {
      const { linkedGitHubRole } = await import('./entry-session');
      return linkedGitHubRole(r);
    });
  const run = (async () => {
    const a = await account().catch(() => null);
    const found = a?.github ? await role(repo).catch(() => null) : null;
    // The server now lists this team in the account's "Your teams" (via GitHub): read the account again once.
    if ((found === 'admin' || found === 'edit') && !a?.teams?.some((t) => t.repo.toLowerCase() === key)) {
      const refresh =
        deps.refresh ??
        (async () => {
          const { getAccount } = await import('./account-session');
          return getAccount(true);
        });
      void refresh().catch(() => undefined);
    }
    current = { repo: key, role: found };
    pending = null;
    subs.forEach((fn) => fn(found));
    return found;
  })();
  pending = { repo: key, run };
  return run;
}

/** Tests: forget what this page read. */
export function resetLinkedRole(): void {
  current = null;
  pending = null;
  subs.length = 0;
}
