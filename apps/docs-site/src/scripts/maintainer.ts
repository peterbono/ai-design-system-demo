// Who is reading: a visitor, someone signed in with a GitHub token, or a maintainer (a token with write access to
// the repository). The Library shows its team tools only to maintainers: "Edit in Studio" next to page titles,
// "View source" in the page meta line, and the avatar next to "Open Studio". Visitors never see them.
//
// <html data-signed-in> and <html data-maintainer> drive the CSS. The head script of Layout.astro paints them from
// the last check (localStorage, keyed to the token's last characters) so nothing jumps on load; this module checks
// the token again at most every ten minutes, and on every connect or disconnect.
import { paintAvatar } from './avatar';
import { API, getToken, markTokenRejected, readRepo, tokenRejected } from './github-session';
import { isContribAuth } from '../lib/contribute';

/** The GitHub token of this browser; never an email member's stand-in (it is not a GitHub token: GitHub refuses it). */
const githubTokenOf = (token: string | null): string | null => (token && !isContribAuth(token) ? token : null);

const KEY = 'bridge.gh.maintainer';
const FRESH_MS = 10 * 60 * 1000;

export interface MaintainerState {
  /** Last characters of the token this state belongs to. */
  key: string;
  login: string;
  avatar: string;
  write: boolean;
  at: number;
}

const keyOf = (token: string) => token.slice(-6);

/** The last check, whatever token it was made with (a renewed sign-in changes the token, rarely the person). */
function readAny(): MaintainerState | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? 'null') as MaintainerState | null;
  } catch {
    return null;
  }
}

function read(token: string | null): MaintainerState | null {
  if (!token) return null;
  const m = readAny();
  return m && m.key === keyOf(token) ? m : null;
}

function write(m: MaintainerState | null) {
  try {
    if (m) localStorage.setItem(KEY, JSON.stringify(m));
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode: state lives for this page only */
  }
}

function paint(m: MaintainerState | null) {
  const root = document.documentElement;
  root.toggleAttribute('data-signed-in', Boolean(m));
  root.toggleAttribute('data-maintainer', Boolean(m?.write));
  document.querySelectorAll<HTMLElement>('[data-team-avatar]').forEach((a) => {
    a.hidden = !m;
    const avatar = a.querySelector<HTMLElement>('[data-team-avatar-img]');
    if (avatar && m) paintAvatar(avatar, m.login, m.avatar, 64);
    const label = a.querySelector('[data-team-avatar-label]');
    if (label && m) label.textContent = `Studio, signed in as ${m.login}`;
  });
}

async function check(token: string): Promise<MaintainerState | null> {
  const headers = { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}` };
  const user = await fetch(`${API}/user`, { headers });
  // GitHub refused the token (revoked, regenerated or expired): the Studio says so in its account block.
  if (user.status === 401) {
    markTokenRejected();
    return null;
  }
  // Rate limited or GitHub down: not an answer about the person, keep the last known state (refresh catches it).
  if (!user.ok) throw new Error(`GitHub answered ${user.status}`);
  const u = (await user.json()) as { login: string; avatar_url: string };
  const r = readRepo();
  const repo = await fetch(`${API}/repos/${r.owner}/${r.repo}`, { headers });
  if (!repo.ok && repo.status !== 404) throw new Error(`GitHub answered ${repo.status}`);
  const p = repo.ok ? ((await repo.json()) as { permissions?: { admin?: boolean; maintain?: boolean; push?: boolean } }).permissions : undefined;
  return { key: keyOf(token), login: u.login, avatar: u.avatar_url, write: Boolean(p && (p.admin || p.maintain || p.push)), at: Date.now() };
}

async function refresh(force = false) {
  const token = githubTokenOf(getToken());
  if (token && tokenRejected()) {
    write(null);
    return paint(null);
  }
  const cached = read(token);
  if (!token) {
    paint(null);
    return write(null);
  }
  // A renewed token (Studio renews sign-ins, often in another tab) has no check of its own yet: keep showing the last
  // known state until the new check answers, so the maintainer tools never blink off and on.
  paint(cached ?? readAny());
  if (!force && cached && Date.now() - cached.at < FRESH_MS) return;
  try {
    const next = await check(token);
    write(next);
    paint(next);
  } catch {
    /* offline or rate limited: keep the last known state */
  }
}

export function initMaintainer() {
  void refresh();
  document.addEventListener('bridge:auth', () => void refresh(true));
  window.addEventListener('storage', (e) => {
    if (e.key === KEY || e.key?.startsWith('bridge.github.token')) void refresh();
  });
}
