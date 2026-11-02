// Someone already signed in who opens "Sign in" or "Get started" (the landing, /signin/): like Figma in the browser,
// they are not shown an empty "Welcome to Bridge" form. The site's buttons read "Open Studio" and go to their team;
// /signin/ shows one primary "Continue as <Name>" to their team and a quiet "Use another account" (the usual form).
// Pure: covered by signin-continue.test.ts. The browser side reads the session (scripts/session-cta.ts, SignIn.tsx).
import { defaultNext, roleWord, type Account } from './account';
import { START_PAGE } from './start';
import { STUDIO_ROOT, teamHref } from './team-path';
import { emailMemberFace } from './people';

/** Who is signed in on this browser, as the sign-in screen and the landing read it. */
export interface SessionFacts {
  /** The Bridge account (email, or GitHub linked to it), when there is one. */
  account: Account | null;
  /** A GitHub sign-in this browser holds without a Bridge account: its login, display name and avatar. */
  github?: { login: string; name?: string | null; avatar?: string | null } | null;
  /** Teams this browser opened, newest first (lib/recent-teams.ts). */
  recent?: readonly string[];
  /** Team names this browser knows ("owner/repo" -> name). */
  teamNames?: Readonly<Record<string, string>>;
  /** The person's role words on the teams this browser knows ("owner/repo" -> "Admin"), lib/recent-teams loadTeamRoles. */
  teamRoles?: Readonly<Record<string, string>>;
}

export interface ContinueAs {
  /** "Dino", or "@login" for a GitHub sign-in without an account. */
  name: string;
  /** Seed of the drawn face (lib/people.ts): the GitHub login, else the member's face from their name. */
  seed: string;
  avatar: string | null;
  /** "Bridge DS · Can edit", or null when there is no team yet. */
  detail: string | null;
  /** Where Continue goes: the team's Studio (the last used of theirs), else the start page. */
  href: string;
}

/** The team a signed-in person continues to: the most recent of theirs this browser opened, else their first. */
function teamOf(account: Account, recent: readonly string[]) {
  const mine = new Map(account.teams.map((t) => [t.repo.toLowerCase(), t]));
  return recent.map((r) => mine.get(r.toLowerCase())).find(Boolean) ?? account.teams[0] ?? null;
}

/** Continue as the person signed in on this browser, or null when nobody is. */
export function continueAs(s: SessionFacts): ContinueAs | null {
  const recent = s.recent ?? [];
  if (s.account) {
    const a = s.account;
    const team = teamOf(a, recent);
    const teamName = team ? (team.name ?? s.teamNames?.[team.repo] ?? team.repo.split('/')[1] ?? team.repo) : null;
    return {
      name: a.name?.trim() || a.email,
      seed: a.github ? a.github.login : emailMemberFace(a.name, a.email),
      avatar: a.github ? `https://github.com/${encodeURIComponent(a.github.login)}.png?size=80` : null,
      detail: team && teamName ? `${teamName} · ${roleWord(team.role)}` : null,
      href: team ? defaultNext(a, recent) : START_PAGE,
    };
  }
  if (s.github?.login) {
    const team = recent[0] ?? null;
    const last = team?.split('/');
    const known = (m: Readonly<Record<string, string>> | undefined) => (team ? (m?.[team.toLowerCase()] ?? m?.[team]) : undefined);
    const teamName = team ? (known(s.teamNames) ?? last?.[1] ?? team) : null;
    const role = known(s.teamRoles);
    return {
      // Their name as GitHub shows it ("Florian"), like the connector's consent; the login when they never set one.
      name: s.github.name?.trim() || `@${s.github.login}`,
      seed: s.github.login,
      avatar: s.github.avatar ?? `https://github.com/${encodeURIComponent(s.github.login)}.png?size=80`,
      detail: teamName ? (role ? `${teamName} · ${role}` : teamName) : null,
      href: last?.length === 2 && last[0] && last[1] ? teamHref(last[0], last[1], null) : STUDIO_ROOT,
    };
  }
  return null;
}

/** The landing's "Sign in" and "Get started": "Open Studio" to the team for someone signed in, unchanged otherwise. */
export function sessionCta(s: SessionFacts): { label: string; href: string } | null {
  const c = continueAs(s);
  return c ? { label: 'Open Studio', href: c.href } : null;
}

// ---- The last email typed on this browser: a convenience for the next sign-in after signing out. ----

export const LAST_EMAIL_KEY = 'bridge.signin.lastEmail';

type EmailStore = Pick<Storage, 'getItem' | 'setItem'>;

export function readLastEmail(store: EmailStore | null | undefined): string {
  try {
    const v = store?.getItem(LAST_EMAIL_KEY) ?? '';
    return /^[^@\s]+@[^@\s]+$/.test(v) ? v : '';
  } catch {
    return '';
  }
}

export function rememberEmail(store: EmailStore | null | undefined, email: string): void {
  const v = email.trim();
  if (!/^[^@\s]+@[^@\s]+$/.test(v)) return;
  try {
    store?.setItem(LAST_EMAIL_KEY, v);
  } catch {
    /* storage blocked: nothing remembered */
  }
}
