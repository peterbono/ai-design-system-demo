// Settings > Account: who Studio acts as. Connected, it is one compact row: avatar, "Connected as @login", the access
// as a status badge, and "Change token" (pasted token) or "Sign out" (Sign in with GitHub) as a quiet action. Read
// only or with a token GitHub refused, it becomes the page's one Harbor zone: a Field Guide drawing (passed as
// children from Astro), one sentence and the one primary action; with a GitHub App that action is "Sign in with
// GitHub" and there is no token paste at all (a token pasted earlier can only be disconnected). State comes from the
// shared GitHub session (scripts/github-session.ts). The badge is the team chip's role (lib/access-view accessBadge):
// an owner reads Admin. An email contributor (lib/contribute.ts) gets the same compact row: the DS drawn face, "Signed
// in as <name>" with "Can edit", their email as the second line, and Sign out, which ends the email session and opens
// the team's sign-in screen.
import { useEffect, useState, type ReactNode } from 'react';
import type { RepoAccessState } from '@bridge-ds/core';
import { Avatar, Badge, Button, Card, CardBody } from '@bridge-ds/react';
import { GitHubMark } from './brand-icons';
import { accountView, type AccountState } from '../../../lib/settings-view';
import { currentViewer, getToken, initGitHubConnect, onAccess, sessionMode, tokenRejected, type Viewer } from '../../../scripts/github-session';
import { safeUrl } from '../../../lib/html';
import { ROLE_WORDS } from '../../../lib/invites';
import { signInHref } from '../../../lib/account';
import { studioBase } from '../../../lib/team-path';

/** An email contributor's account row: drawn face, name and role, email, Sign out. */
function ContributorRow({ viewer, repo }: { viewer: Viewer; repo: string }) {
  const [face, setFace] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const email = viewer.email ?? viewer.login;
  useEffect(() => {
    let live = true;
    void import('@bridge-ds/react/avatar-illustrated').then(({ illustratedAvatarUri }) => live && setFace(illustratedAvatarUri(email)));
    return () => {
      live = false;
    };
  }, [email]);
  const signOut = async () => {
    setBusy(true);
    const { signOutEmail } = await import('../../../scripts/contribute-session');
    try {
      await signOutEmail(repo);
    } finally {
      // The one sign-in screen of Bridge, back to the team afterwards.
      location.assign(signInHref(studioBase(location.pathname, true)));
    }
  };
  return (
    <Card data-state="connected">
      <CardBody>
        <div className="set-account" aria-live="polite">
          <Avatar name={viewer.name || email} src={face} size="md" decorative />
          <div className="set-account-text">
            <p className="set-account-title">
              Signed in as {viewer.name || email}
              <Badge tone="success" size="sm" dot>
                {ROLE_WORDS.edit.label}
              </Badge>
            </p>
            <p className="set-account-sub set-account-email">{email}</p>
          </div>
          <Button variant="ghost" className="set-account-action" loading={busy} onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

export interface SettingsAccountProps {
  /** owner/repo, as the page reads it. */
  repo: string;
  /** The Field Guide drawing shown while Studio is read only. */
  children?: ReactNode;
  /** The site has a GitHub App (build time): Sign in with GitHub is the only way in, no token paste. */
  signIn?: boolean;
}

/** The DOM hooks of each action (scripts/github-session.ts listens for them). */
const ACTION_ATTRS = {
  signin: { 'data-gh-open': '', 'data-gh-signin': '' },
  token: { 'data-gh-open': 'token' },
  signout: { 'data-gh-forget': '' },
} as const;

export default function SettingsAccount({ repo, children, signIn = false }: SettingsAccountProps) {
  // The server renders "checking": the token lives in this browser only.
  const [state, setState] = useState<AccountState>('checking');
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [write, setWrite] = useState<boolean | null>(null);
  const [reach, setReach] = useState<boolean | null>(null);
  const [accessState, setAccessState] = useState<RepoAccessState | null>(null);
  const [mode, setMode] = useState<'token' | 'app'>('token');

  useEffect(() => {
    const read = (v: Viewer | null) => {
      setViewer(v);
      setMode(sessionMode());
      setState(v ? 'connected' : tokenRejected() ? 'rejected' : 'readonly');
      if (!v) {
        setWrite(null);
        setReach(null);
        setAccessState(null);
      }
    };
    if (!getToken()) setState('readonly');
    initGitHubConnect(read);
    onAccess((a) => {
      setWrite(a ? a.write : null);
      setReach(a && typeof a.reach === 'boolean' ? a.reach : null);
      setAccessState(a?.state ?? null);
    });
    const onAuth = () => read(currentViewer());
    document.addEventListener('bridge:auth', onAuth);
    return () => document.removeEventListener('bridge:auth', onAuth);
  }, []);

  if (state === 'connected' && viewer?.email) return <ContributorRow viewer={viewer} repo={repo} />;
  const view = accountView(state, { login: viewer?.login, write, repo, mode, signIn, reach, state: accessState });
  const attrs = ACTION_ATTRS[view.actionKind ?? 'token'];

  if (view.zone) {
    return (
      <div className="zone set-account set-account-zone" data-state={state}>
        <div className="set-account-art" aria-hidden="true">
          {children}
        </div>
        <div className="set-account-text">
          <p className="set-account-title">{view.title}</p>
          <p className="set-account-sub">{view.detail}</p>
        </div>
        <div className="set-account-actions">
          <Button variant="primary" iconStart={GitHubMark} className="set-account-action" {...attrs}>
            {view.action}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Card data-state={state}>
      <CardBody>
        <div className="set-account" aria-live="polite">
          {viewer && <Avatar name={viewer.name || viewer.login} src={safeUrl(viewer.avatar_url) ? `${viewer.avatar_url}${viewer.avatar_url.includes('?') ? '&' : '?'}s=64` : undefined} size="md" decorative />}
          <div className="set-account-text">
            <p className="set-account-title">
              {view.title}
              {view.badge && (
                <Badge tone={view.badge.tone} size="sm" dot>
                  {view.badge.label}
                </Badge>
              )}
            </p>
            {view.detail && <p className="set-account-sub">{view.detail}</p>}
          </div>
          {view.action && (
            <Button variant="ghost" className="set-account-action" {...attrs}>
              {view.action}
            </Button>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

/** The left column's words for an email contributor. */
export const CONTRIBUTOR_ACCOUNT_INTRO = 'You joined with your email. Bridge saves your changes to the library for you.';

/**
 * A team's Settings (pages/team-shell/settings): the Account band, first, for an email contributor only (the team's
 * GitHub people sign in from the side nav). Nothing for anyone else.
 */
export function ContributorAccountBand() {
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [repo, setRepo] = useState('');
  useEffect(() => {
    let live = true;
    void import('../../../scripts/repo-context').then(({ repoContext }) => {
      const r = repoContext();
      if (live) setRepo(`${r.owner}/${r.repo}`);
    });
    initGitHubConnect((v) => live && setViewer(v));
    const onAuth = () => live && setViewer(currentViewer());
    document.addEventListener('bridge:auth', onAuth);
    return () => {
      live = false;
      document.removeEventListener('bridge:auth', onAuth);
    };
  }, []);
  if (!viewer?.email || !repo) return null;
  return (
    <section className="ts-band" id="connection" aria-labelledby="set-account">
      <h2 id="set-account" className="ts-h">
        Account
      </h2>
      <p className="ts-intro">{CONTRIBUTOR_ACCOUNT_INTRO}</p>
      <ContributorRow viewer={viewer} repo={repo} />
    </section>
  );
}
