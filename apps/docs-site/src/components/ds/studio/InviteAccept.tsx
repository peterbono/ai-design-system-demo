// Where an invitation email leads (pages/studio/invite.astro): /studio/invite/#t=<token>. The token stays in the
// address fragment, never sent to a server log, and leaves the address bar at once (kept in this tab only until it is
// used). Two ways in, by role:
//   Can edit         "Join with your email" first (lib/contribute.ts): the invited address (masked), a name and
//                    "Join <team>". Bridge accepts on the server (scripts/contribute-session.ts acceptEmailInvite) and
//                    opens the team, signed in with that email. No GitHub account needed. A quiet link under it,
//                    "I use GitHub, sign in with GitHub instead", keeps the GitHub way.
//   Reviewer, Admin  Sign in with GitHub, as before (they approve and merge on GitHub), with "New to GitHub? Create a
//                    free account with this email" under it. Signed in, Bridge accepts the invitation on the server
//                    (scripts/invites-api.ts acceptInvite), which adds this GitHub account to the team.
// The invite's role comes first from the invites server (scripts/invites-api.ts peekInvite: team, role, masked email);
// when it cannot say, the email way is offered first and a reviewer or admin invite answers "sign in with GitHub"
// (409 github-required). Every failure says how to fix it. Only the invited person joins: when the GitHub account
// does not have the invited email, verified, the page says where it was sent and which account is signed in, with
// "Use another GitHub account" and "Add this email to @login on GitHub"; it checks again when the tab comes back.
import { useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, ExternalLink, LogOut } from 'lucide-react';
import { Button, ButtonGroup, Input, Link } from '@bridge-ds/react';
import ButtonLink from '../ButtonLink';
import { GitHubMark } from './brand-icons';
import { acceptEmailWords, GITHUB_EMAILS_URL, ROLE_WORDS, roleLabel, MEMBERS_WORDS, type AcceptEmailCode } from '../../../lib/invites';
import { CONTRIBUTE_WORDS, GITHUB_SIGNUP_URL, teamWord, type InvitePeek } from '../../../lib/contribute';
import { teamHref } from '../../../lib/team-path';
import type { AcceptResult } from '../../../scripts/invites-api';

export const INVITE_TOKEN_KEY = 'bridge.invite.token';
/** Set when the invitee chose GitHub for a "Can edit" invite: after the GitHub round trip the page joins with it. */
export const INVITE_VIA_KEY = 'bridge.invite.via';

/** The note under "Use another GitHub account" (the same words as the access screens). */
const SWITCH_NOTE = 'GitHub uses the account open in this browser. Switch accounts on github.com first if needed.';

/** Where the page goes once joined with an email (tests replace it). */
export const navigate = { to: (href: string) => location.assign(href) };

/** The token from `#t=...`, if the fragment carries one that looks like ours. */
export function tokenFromHash(hash: string): string | null {
  const m = /(?:^#|&)t=([A-Za-z0-9_-]{20,128})(?:&|$)/.exec(hash);
  return m ? m[1]! : null;
}

type View =
  | { kind: 'checking' }
  | { kind: 'missing' }
  | { kind: 'email-join'; peek: InvitePeek | null; note?: string }
  | { kind: 'signin'; note?: string }
  | { kind: 'joining' }
  | { kind: 'done'; result: AcceptResult }
  | { kind: 'error'; text: string; retry: boolean }
  | { kind: 'email'; code: AcceptEmailCode; sentTo: string; login: string };

const EMAIL_CODES: readonly string[] = ['email_mismatch', 'email_unverified', 'email_access'];

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
    sessionStorage.removeItem(INVITE_VIA_KEY);
  } catch {
    /* storage blocked: nothing kept */
  }
}

function choseGitHub(): boolean {
  try {
    return sessionStorage.getItem(INVITE_VIA_KEY) === 'github';
  } catch {
    return false;
  }
}

function chooseGitHub() {
  try {
    sessionStorage.setItem(INVITE_VIA_KEY, 'github');
  } catch {
    /* storage blocked: the page asks again after GitHub */
  }
}

export default function InviteAccept() {
  const [view, setView] = useState<View>({ kind: 'checking' });
  const [token, setToken] = useState<string | null>(null);
  const [run, setRun] = useState(0);
  const [peek, setPeek] = useState<InvitePeek | null>(null);
  const [githubLogin, setGithubLogin] = useState<string | null>(null);

  useEffect(() => {
    const t = readToken();
    setToken(t);
    if (!t) return setView({ kind: 'missing' });
    let live = true;
    void (async () => {
      const [session, invites] = await Promise.all([import('../../../scripts/github-session'), import('../../../scripts/invites-api')]);
      let p: InvitePeek | null = null;
      try {
        p = await invites.peekInvite(t);
      } catch {
        // The server says the link is spent or expired: the same screen as a failed accept.
        if (!live) return;
        forgetToken();
        return setView({ kind: 'error', text: 'This invitation expired or was already used. Ask your admin to send a new one.', retry: false });
      }
      if (!live) return;
      setPeek(p);
      session.initGitHubConnect((v) => {
        if (!live) return;
        setGithubLogin(v?.email ? null : (v?.login ?? null));
        // "Can edit" (or a role the server could not say): the email way first, unless the person chose GitHub.
        const emailFirst = (!p || p.role === 'edit') && !choseGitHub();
        if (emailFirst) return setView((cur) => (cur.kind === 'checking' ? { kind: 'email-join', peek: p } : cur));
        if (v && !v.email) {
          setView({ kind: 'joining' });
          setRun((n) => n + 1);
        } else setView({ kind: 'signin' });
      });
    })();
    return () => {
      live = false;
    };
  }, []);

  // Back from GitHub's email settings (another tab): the page checks again on its own, no Try again to find.
  const mismatch = view.kind === 'email' && view.code === 'email_mismatch';
  useEffect(() => {
    if (!mismatch) return;
    const again = () => {
      if (document.visibilityState === 'visible') setRun((n) => n + 1);
    };
    document.addEventListener('visibilitychange', again);
    return () => document.removeEventListener('visibilitychange', again);
  }, [mismatch]);

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
        if (err instanceof api.InvitesError && EMAIL_CODES.includes(err.code)) {
          const str = (v: unknown) => (typeof v === 'string' ? v : '');
          return setView({ kind: 'email', code: err.code as AcceptEmailCode, sentTo: str(err.details.sentTo), login: str(err.details.login) });
        }
        const gone = err instanceof api.InvitesError && err.status === 410;
        if (gone) forgetToken();
        setView({ kind: 'error', text: unavailable ? MEMBERS_WORDS.unavailable : err instanceof Error ? err.message : 'Something went wrong.', retry: !unavailable && !gone });
      }
    });
    return () => {
      live = false;
    };
  }, [run, token]);

  /** "I use GitHub": signed in, join with that account now; signed out, GitHub first (the button carries data-gh-signin). */
  const useGitHub = () => {
    chooseGitHub();
    if (githubLogin) {
      setView({ kind: 'joining' });
      setRun((n) => n + 1);
    }
  };

  if (view.kind === 'checking' || view.kind === 'joining')
    return (
      <Shell title={view.kind === 'joining' ? 'Joining the team' : 'Opening your invitation'} sub={view.kind === 'joining' ? 'Bridge is adding you with the role your admin picked.' : ''} />
    );
  if (view.kind === 'missing') return <Shell title="This invitation link is incomplete" sub="Open the link from the invitation email again, or ask your admin to send a new one." />;
  if (view.kind === 'email-join')
    return (
      <EmailJoin
        token={token!}
        peek={view.peek}
        github={githubLogin}
        onGitHub={useGitHub}
        onGitHubRequired={() => {
          chooseGitHub();
          if (githubLogin) {
            setView({ kind: 'joining' });
            setRun((n) => n + 1);
          } else setView({ kind: 'signin', note: CONTRIBUTE_WORDS.githubRequired });
        }}
        onGone={(text) => {
          forgetToken();
          setView({ kind: 'error', text, retry: false });
        }}
      />
    );
  if (view.kind === 'signin')
    return (
      <Shell
        title="You're invited to a design system on Bridge"
        sub={view.note ?? 'Sign in with GitHub to join. Bridge adds you with the role your admin picked.'}
        foot={
          <>
            {CONTRIBUTE_WORDS.newToGitHub}{' '}
            <Link href={GITHUB_SIGNUP_URL} external>
              {CONTRIBUTE_WORDS.createAccount}
            </Link>
          </>
        }
      >
        <Button variant="primary" size="lg" iconStart={GitHubMark} data-gh-open="" data-gh-signin="">
          Sign in with GitHub
        </Button>
      </Shell>
    );
  if (view.kind === 'email') {
    const w = acceptEmailWords(view.code, view.sentTo, view.login);
    if (view.code === 'email_access')
      return (
        <Shell title={w.title} sub={w.sub}>
          <Button variant="primary" size="lg" iconStart={GitHubMark} data-gh-signin="">
            {w.action}
          </Button>
        </Shell>
      );
    if (view.code === 'email_mismatch' && view.login)
      return (
        <Shell title={w.title} sub={CONTRIBUTE_WORDS.mismatch(view.sentTo, view.login)} foot={SWITCH_NOTE}>
          <ButtonGroup>
            <Button
              variant="primary"
              size="lg"
              iconStart={LogOut}
              data-gh-forget=""
              onClick={() => {
                // The shared session signs out on the same click (data-gh-forget); then GitHub again, back to this page.
                setTimeout(() => void import('../../../scripts/github-session').then((s) => s.startSignIn()), 0);
              }}
            >
              {CONTRIBUTE_WORDS.useAnother}
            </Button>
            <ButtonLink href={GITHUB_EMAILS_URL} variant="secondary" size="lg" iconEnd={ExternalLink} target="_blank" rel="noopener noreferrer">
              {CONTRIBUTE_WORDS.addEmail(view.login)}
            </ButtonLink>
          </ButtonGroup>
        </Shell>
      );
    return (
      <Shell title={w.title} sub={w.sub}>
        <ButtonGroup>
          <ButtonLink href={GITHUB_EMAILS_URL} variant="primary" size="lg" iconEnd={ExternalLink} target="_blank" rel="noopener noreferrer">
            {w.action}
          </ButtonLink>
          <Button variant="secondary" size="lg" onClick={() => setRun((n) => n + 1)}>
            Try again
          </Button>
        </ButtonGroup>
      </Shell>
    );
  }
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
    <Shell title={`You're in ${peek?.team ?? result.repo}`} sub={`You are ${role}: ${ROLE_WORDS[result.role].help.replace(/^Also /, '').replace(/^./, (c) => c.toLowerCase())}${result.ownersPr ? ` ${MEMBERS_WORDS.reviewerNote}` : ''}`}>
      {open}
    </Shell>
  );
}

/**
 * "Join with your email" for a "Can edit" invite: the invited address (masked), a name, "Join <team>". On success the
 * team's Studio home opens, signed in with the email. The GitHub way stays one quiet link below.
 */
function EmailJoin({ token, peek, github, onGitHub, onGitHubRequired, onGone }: { token: string; peek: InvitePeek | null; github: string | null; onGitHub: () => void; onGitHubRequired: () => void; onGone: (text: string) => void }) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const team = teamWord(peek);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError(CONTRIBUTE_WORDS.nameMissing);
    setError(null);
    setFailed(null);
    setBusy(true);
    const api = await import('../../../scripts/contribute-session');
    try {
      const { repo } = await api.acceptEmailInvite(token, name);
      forgetToken();
      const [owner = '', name_ = ''] = repo.split('/');
      navigate.to(teamHref(owner, name_, null));
    } catch (err) {
      setBusy(false);
      if (err instanceof api.ContributeError && err.status === 409) return onGitHubRequired();
      if (err instanceof api.ContributeError && err.status === 410) return onGone('This invitation expired or was already used. Ask your admin to send a new one.');
      setFailed(err instanceof Error && err.message ? err.message : CONTRIBUTE_WORDS.network);
    }
  };

  return (
    <div className="inv-accept-text">
      <h1 className="inv-accept-title">{CONTRIBUTE_WORDS.joinTitle(team)}</h1>
      <p className="inv-accept-sub">{CONTRIBUTE_WORDS.joinLead(peek?.sentTo)}</p>
      <form className="inv-accept-form" noValidate onSubmit={(e) => void submit(e)}>
        <Input
          label={CONTRIBUTE_WORDS.nameLabel}
          hint={CONTRIBUTE_WORDS.nameHelp}
          name="name"
          autoComplete="name"
          size="lg"
          placeholder={CONTRIBUTE_WORDS.namePlaceholder}
          value={name}
          error={error ?? undefined}
          onValueChange={(v) => {
            setName(v);
            if (error) setError(null);
          }}
        />
        <div className="inv-accept-actions">
          <Button type="submit" variant="primary" size="lg" loading={busy}>
            {CONTRIBUTE_WORDS.join(team)}
          </Button>
        </div>
        <p className="inv-accept-sub" role="status">
          {failed}
        </p>
      </form>
      <p className="inv-accept-more">
        <Button variant="link" size="sm" iconStart={GitHubMark} onClick={onGitHub} {...(github ? {} : { 'data-gh-signin': '' })}>
          {CONTRIBUTE_WORDS.useGitHub}
        </Button>
      </p>
    </div>
  );
}

/** One state of the page: the title, one sentence, a line above the actions, the actions, a quiet line under them. */
function Shell({ title, sub, lead, foot, children }: { title: string; sub: string; lead?: React.ReactNode; foot?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="inv-accept-text">
      <h1 className="inv-accept-title">{title}</h1>
      <p className="inv-accept-sub" role="status">
        {sub}
      </p>
      {lead}
      {children && <div className="inv-accept-actions">{children}</div>}
      {foot && <p className="inv-accept-more">{foot}</p>}
    </div>
  );
}
