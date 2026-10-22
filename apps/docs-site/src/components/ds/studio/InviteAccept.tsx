// Where an invitation email leads (pages/studio/invite.astro): /studio/invite/#t=<token>. The token stays in the
// address fragment, never sent to a server log, and leaves the address bar at once (kept in this tab only until it is
// used). Signed out, one sentence and "Sign in with GitHub"; signed in, Bridge accepts the invitation on the server
// (scripts/invites-api.ts acceptInvite), which adds this GitHub account to the team with the role the admin picked.
// Then "Open the team". When GitHub still wants the person to accept on github.com (they are not in the
// organization), one more button does that. Every failure says how to fix it.
import { useEffect, useState } from 'react';
import { ArrowRight, ExternalLink } from 'lucide-react';
import { Button, ButtonGroup } from '@bridge-ds/react';
import ButtonLink from '../ButtonLink';
import { GitHubMark } from './brand-icons';
import { ROLE_WORDS, roleLabel, MEMBERS_WORDS } from '../../../lib/invites';
import { teamHref } from '../../../lib/team-path';
import type { AcceptResult } from '../../../scripts/invites-api';

export const INVITE_TOKEN_KEY = 'bridge.invite.token';

/** The token from `#t=...`, if the fragment carries one that looks like ours. */
export function tokenFromHash(hash: string): string | null {
  const m = /(?:^#|&)t=([A-Za-z0-9_-]{20,128})(?:&|$)/.exec(hash);
  return m ? m[1]! : null;
}

type View =
  | { kind: 'checking' }
  | { kind: 'missing' }
  | { kind: 'signin' }
  | { kind: 'joining' }
  | { kind: 'done'; result: AcceptResult }
  | { kind: 'error'; text: string; retry: boolean };

function readToken(): string | null {
  const fromHash = tokenFromHash(location.hash);
  try {
    if (fromHash) sessionStorage.setItem(INVITE_TOKEN_KEY, fromHash);
    // The token leaves the address bar (history, screenshots, shared screens) as soon as it is read.
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    return fromHash ?? sessionStorage.getItem(INVITE_TOKEN_KEY);
  } catch {
    return fromHash;
  }
}

function forgetToken() {
  try {
    sessionStorage.removeItem(INVITE_TOKEN_KEY);
  } catch {
    /* storage blocked: nothing kept */
  }
}

export default function InviteAccept() {
  const [view, setView] = useState<View>({ kind: 'checking' });
  const [token, setToken] = useState<string | null>(null);
  const [run, setRun] = useState(0);

  useEffect(() => {
    const t = readToken();
    setToken(t);
    if (!t) return setView({ kind: 'missing' });
    let live = true;
    void import('../../../scripts/github-session').then((session) =>
      session.initGitHubConnect((v) => {
        if (!live) return;
        setView(v ? { kind: 'joining' } : { kind: 'signin' });
        if (v) setRun((n) => n + 1);
      }),
    );
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!run || !token) return;
    let live = true;
    void import('../../../scripts/invites-api').then(async (api) => {
      try {
        const result = await api.acceptInvite(token);
        if (!live) return;
        forgetToken();
        setView({ kind: 'done', result });
      } catch (err) {
        if (!live) return;
        const unavailable = err instanceof api.InvitesUnavailable;
        const gone = err instanceof api.InvitesError && err.status === 410;
        if (gone) forgetToken();
        setView({ kind: 'error', text: unavailable ? MEMBERS_WORDS.unavailable : err instanceof Error ? err.message : 'Something went wrong.', retry: !unavailable && !gone });
      }
    });
    return () => {
      live = false;
    };
  }, [run, token]);

  if (view.kind === 'checking' || view.kind === 'joining')
    return (
      <Shell title={view.kind === 'joining' ? 'Joining the team' : 'Opening your invitation'} sub={view.kind === 'joining' ? 'Bridge is adding you with the role your admin picked.' : ''} />
    );
  if (view.kind === 'missing') return <Shell title="This invitation link is incomplete" sub="Open the link from the invitation email again, or ask your admin to send a new one." />;
  if (view.kind === 'signin')
    return (
      <Shell title="You're invited to a design system on Bridge" sub="Sign in with GitHub to join. Bridge adds you with the role your admin picked.">
        <Button variant="primary" size="lg" iconStart={GitHubMark} data-gh-open="" data-gh-signin="">
          Sign in with GitHub
        </Button>
      </Shell>
    );
  if (view.kind === 'error')
    return (
      <Shell title="Bridge could not add you yet" sub={view.text}>
        {view.retry && (
          <Button variant="primary" size="lg" onClick={() => setRun((n) => n + 1)}>
            Try again
          </Button>
        )}
      </Shell>
    );
  const { result } = view;
  const [owner = '', repo = ''] = result.repo.split('/');
  const role = roleLabel({ role: result.role, ...(result.reviewAs ? { reviewAs: result.reviewAs } : {}) });
  const open = (
    <ButtonLink href={teamHref(owner, repo, null)} variant={result.status === 'joined' ? 'primary' : 'secondary'} size="lg" iconEnd={ArrowRight}>
      Open the team
    </ButtonLink>
  );
  if (result.status === 'accept-on-github')
    return (
      <Shell title="One last step on GitHub" sub={`GitHub asks you to accept the invitation to ${result.repo} once. Then come back: you are ${role}.`}>
        <ButtonGroup>
          <ButtonLink href={result.acceptUrl ?? `https://github.com/${result.repo}/invitations`} variant="primary" size="lg" iconEnd={ExternalLink} target="_blank" rel="noopener noreferrer">
            Accept on GitHub
          </ButtonLink>
          {open}
        </ButtonGroup>
      </Shell>
    );
  return (
    <Shell title={`You're in ${result.repo}`} sub={`You are ${role}: ${ROLE_WORDS[result.role].help.replace(/^Also /, '').replace(/^./, (c) => c.toLowerCase())}${result.ownersPr ? ` ${MEMBERS_WORDS.reviewerNote}` : ''}`}>
      {open}
    </Shell>
  );
}

function Shell({ title, sub, children }: { title: string; sub: string; children?: React.ReactNode }) {
  return (
    <div className="inv-accept-text">
      <h1 className="inv-accept-title">{title}</h1>
      <p className="inv-accept-sub" role="status">
        {sub}
      </p>
      {children && <div className="inv-accept-actions">{children}</div>}
    </div>
  );
}
