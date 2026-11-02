// What a team's Bridge shows when GitHub does not let the visitor in, or only partly (multi-team plan 7.3), one screen
// per access state (lib/access-view.ts accessScreen):
//   - block: the page content gives way to one Harbor zone with a Field Guide drawing, the title, one paragraph, the
//     one primary action first (Sign in with GitHub, or Ask your lead for access, which copies a ready message), a
//     secondary, quiet links and a note. The nav stays, so the team chip still says where you are.
//   - banner: one DS Banner over a read-only Studio (guest on a public repository, Bridge not set up, outside the team).
// "Ask to join the team" (outside the team, or a Bridge account that is not on it) sends a join request inside Bridge
// on the hosted site (AskButton): the admins see it in their join rows (Home, Settings > Members) and approve it there.
// Signed in with GitHub only, Bridge first signs the person in to an account with that GitHub (it has their email).
// When Bridge cannot send it, the ready message is copied instead and the page says so.
// "Continue with email" (real teams with email sign-in) opens the one sign-in screen of Bridge (pages/signin.astro)
// with ?next=<this page>; GitHub stays the primary action here and an option there.
// TeamAccessGate mounts it on every team page (layouts/Layout.astro, hosted only) and also opens the hosted
// onboarding there on ?setup=<step> (components/ds/studio/Onboarding.tsx, step 2 hosted states, step Invite your team).
import { useCallback, useEffect, useState } from 'react';
import '../../../styles/onboarding.css';
import '../../../styles/requests.css';
import { AlertTriangle, Check, Copy, Info, LogOut, Mail, UserPlus } from 'lucide-react';
import { Banner, Button, Link } from '@bridge-ds/react';
import type { RepoAccessState } from '@bridge-ds/core';
import ButtonLink from '../ButtonLink';
import { GitHubMark } from './brand-icons';
import { Drawing } from './Drawing';
import { useCopy } from './TeamLink';
import { HostedOnboarding, setupStepFromUrl } from './Onboarding';
import { accessScreen, ASK_WORDS, SIGN_IN_PARAM, SIGNED_OUT_ELSEWHERE_KEY, signedOutScreen, teamLink, type AccessAction, type AccessScreen } from '../../../lib/access-view';
import { signInHref } from '../../../lib/account';
import { isHostedSite, studioBase } from '../../../lib/team-path';
import { isDemoRepo } from '../../../lib/demo';
import { updatedLine } from '../../../lib/activity-view';
import { CONTRIBUTE_WORDS, contributeEligible } from '../../../lib/contribute';
import { knownTeamName } from '../../../lib/recent-teams';
import { linkedMember, reconnectScreen, type LinkedRole } from '../../../lib/linked-role';

/** The sign-in screen, back to this page afterwards. */
const signInHere = () => signInHref(typeof location === 'undefined' ? null : location.pathname + location.search + location.hash);

/** The attributes the shared GitHub session listens for (scripts/github-session.ts). */
const SESSION_ATTRS = {
  signin: { 'data-gh-open': '', 'data-gh-signin': '' },
  signout: { 'data-gh-forget': '' },
} as const;

/**
 * Ask to join the team inside Bridge. Already asked (the server says so): the line instead of the button. Without a
 * Bridge account, the GitHub sign-in of this browser makes or opens one first. Bridge cannot send it: the message is
 * copied, and said.
 */
function AskButton({ action, variant, copy, onSent }: { action: Extract<AccessAction, { kind: 'ask' }>; variant: 'primary' | 'secondary'; copy: (text: string, done: string) => void; onSent?: () => void }) {
  const [state, setState] = useState<'idle' | 'busy' | 'sent' | 'copied'>('idle');
  useEffect(() => {
    if (state === 'sent') onSent?.();
  }, [state, onSent]);
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const { getAccount } = await import('../../../scripts/account-session');
        if (!(await getAccount()).account) return;
        const { askedToJoin } = await import('../../../scripts/entry-session');
        if (live && (await askedToJoin(action.repo))) setState('sent');
      } catch {
        // The button stays.
      }
    })();
    return () => {
      live = false;
    };
  }, [action.repo]);
  const fallback = () => {
    setState('copied');
    copy(action.fallback.text, ASK_WORDS.fallback);
  };
  const ask = async () => {
    setState('busy');
    try {
      const acc = await import('../../../scripts/account-session');
      if (!(await acc.getAccount()).account) {
        const token = await acc.workingGitHubToken();
        if (!token) return fallback();
        await acc.signInWithGitHub(token);
      }
      const { askToJoin } = await import('../../../scripts/entry-session');
      const r = await askToJoin(action.repo);
      if ('joined' in r) {
        // An invite was waiting: they are in.
        location.assign(r.next || location.href);
        return;
      }
      setState('sent');
    } catch (err) {
      // Already on the team (409): the page opens with their access.
      if ((err as { status?: number }).status === 409) {
        location.reload();
        return;
      }
      fallback();
    }
  };
  if (state === 'sent')
    return (
      <span className="na-sent" role="status">
        <Check aria-hidden="true" size={16} /> {ASK_WORDS.sent}
      </span>
    );
  return (
    <>
      <Button variant={variant} iconStart={state === 'copied' ? Check : UserPlus} loading={state === 'busy'} disabled={state === 'busy'} onClick={() => void ask()}>
        {state === 'copied' ? 'Message copied' : state === 'busy' ? ASK_WORDS.sending : action.label}
      </Button>
      {/* Said once to a screen reader by the page's live line (useCopy); shown here for everyone else. */}
      {state === 'copied' && (
        <span className="na-quiet" aria-hidden="true">
          {ASK_WORDS.fallback}
        </span>
      )}
    </>
  );
}

function ActionButton({ action, variant, copy, copied, onSent }: { action: AccessAction; variant: 'primary' | 'secondary'; copy: (text: string, done: string) => void; copied: boolean; onSent?: () => void }) {
  switch (action.kind) {
    case 'ask':
      return <AskButton action={action} variant={variant} copy={copy} {...(onSent ? { onSent } : {})} />;
    case 'email':
      return (
        <ButtonLink variant={variant} iconStart={Mail} href={signInHere()}>
          {action.label}
        </ButtonLink>
      );
    case 'signin':
      return (
        <Button variant={variant} iconStart={GitHubMark} {...SESSION_ATTRS.signin}>
          {action.label}
        </Button>
      );
    case 'signout':
      return (
        <Button variant={variant} iconStart={LogOut} {...SESSION_ATTRS.signout}>
          {action.label}
        </Button>
      );
    case 'copy':
      return (
        <Button variant={variant} iconStart={copied ? Check : Copy} onClick={() => copy(action.text, action.copied)}>
          {copied ? 'Message copied' : action.label}
        </Button>
      );
    case 'link':
      return (
        <ButtonLink variant={variant} href={action.href} {...(action.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
          {action.label}
        </ButtonLink>
      );
  }
}

export interface NoAccessProps {
  screen: AccessScreen;
  /** "owner/repo" of a team with email sign-in (screens with the email action). */
  repo?: string;
  /** The visitor opened an older team sign-in link that expired: said under the actions. */
  emailExpired?: boolean;
  /** When the page reads the team's published activity (a guest): when it was written, said quietly in the banner. */
  updatedAt?: string | null;
}

/** One access screen: the full block or the banner. */
export function NoAccess({ screen, updatedAt, repo = '', emailExpired = false }: NoAccessProps) {
  const { copied, said, copy } = useCopy(3000);
  // "Invited with your email? Continue with email": the one sign-in screen, back here afterwards.
  const emailLink = repo ? screen.links?.find((l) => l.action.kind === 'email') : undefined;
  // While this screen asks to sign in, the side nav's own "Connect GitHub" would be a second call to action: hidden.
  const asksSignIn = screen.layout === 'block' && (screen.primary.kind === 'signin' || screen.primary.kind === 'email');
  useEffect(() => {
    const root = document.documentElement;
    root.toggleAttribute('data-signin-card', asksSignIn);
    return () => root.removeAttribute('data-signin-card');
  }, [asksSignIn]);
  const run = (text: string, done: string) => void copy(text, done);
  const live = (
    <p className="sr-only" role="status" aria-live="polite">
      {said}
    </p>
  );
  const fallback = said && !copied ? <p className="na-quiet">{said}</p> : null;
  // Asked to join (now or earlier): the sentence stops asking, the sent line beside it says what happens next.
  const [asked, setAsked] = useState(false);
  const onAsked = useCallback(() => setAsked(true), []);

  if (screen.layout === 'banner') {
    return (
      <Banner
        className="na-banner"
        appearance="neutral"
        icon={screen.tone === 'warning' ? AlertTriangle : Info}
        title={screen.title}
        actions={
          <>
            <ActionButton action={screen.primary} variant="secondary" copy={run} copied={copied} onSent={onAsked} />
            {emailLink && (
              <Link href={signInHere()} className="na-banner-link">
                {emailLink.action.label}
              </Link>
            )}
          </>
        }
      >
        {asked && screen.primary.kind === 'ask' ? ASK_WORDS.waiting : screen.body}
        {updatedAt && (
          <span className="na-updated">
            {' '}
            <time dateTime={updatedAt} title={new Date(updatedAt).toLocaleString('en-US')}>
              {updatedLine(updatedAt)}
            </time>
            .
          </span>
        )}
        {live}
        {fallback}
      </Banner>
    );
  }

  return (
    <section className="zone na" aria-labelledby="na-title">
      <div className="na-art" aria-hidden="true">
        <Drawing name="guide" width={112} />
      </div>
      <div className="na-text">
        <h1 id="na-title" className="na-title">
          {screen.title}
        </h1>
        <p className="na-body">{screen.body}</p>
        <div className="na-actions">
          <ActionButton action={screen.primary} variant="primary" copy={run} copied={copied} />
          {screen.secondary && <ActionButton action={screen.secondary} variant="secondary" copy={run} copied={copied} />}
        </div>
        {live}
        {fallback}
        {screen.links?.map((l) =>
            l.action.kind === 'link' ? (
              <p key={l.action.href} className="na-link">
                {l.lead && <span>{l.lead} </span>}
                <Link href={l.action.href} external={l.action.external}>
                  {l.action.label}
                </Link>
              </p>
            ) : l.action.kind === 'email' && emailLink ? (
              <p key="email" className="na-link">
                {l.lead && <span>{l.lead} </span>}
                <Link href={signInHere()}>{l.action.label}</Link>
              </p>
            ) : null,
          )}
        {emailExpired && (emailLink || (repo && screen.primary.kind === 'email')) && <p className="na-quiet">{CONTRIBUTE_WORDS.expired}</p>}
        {screen.note && <p className="na-quiet">{screen.note}</p>}
      </div>
    </section>
  );
}

/** This page's address without ?signin: where the sign-in screen comes back to. */
function withoutSignIn(): string {
  const url = new URL(location.href);
  url.searchParams.delete(SIGN_IN_PARAM);
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Hides the page content under the gate while a block or the onboarding takes the page (styles/team-access.css). */
function useTakeover(on: boolean) {
  useEffect(() => {
    const root = document.documentElement;
    root.toggleAttribute('data-access-takeover', on);
    return () => root.removeAttribute('data-access-takeover');
  }, [on]);
}

export interface GateState {
  owner: string;
  repo: string;
  login: string | null;
  /** The viewer's profile name on GitHub, when they gave one: the setup greets them by their first name. */
  name?: string | null;
  access: RepoAccessState | null;
  repoAdmin: boolean;
  /** This site signs email contributors in on this team (real teams only). */
  email?: boolean;
  /** The sign-in link from an email had expired. */
  emailExpired?: boolean;
  /** This site sends join requests inside Bridge (the hosted one). */
  asks?: boolean;
  /** Signed in to a Bridge account that is not on this team. */
  account?: boolean;
  /** No GitHub sign-in in this browser, and the account's linked GitHub is on the team (scripts/linked-role.ts). */
  linked?: LinkedRole | null;
  /** The GitHub login linked to the Bridge account, to name it in the reconnect banner. */
  linkedLogin?: string | null;
}

/**
 * The access gate of a team's Bridge: the screen of the visitor's access state over the page, or, on the team's home
 * with ?setup=<step> and signed in, the onboarding. Renders nothing for a reader, writer or admin, and nothing until
 * GitHub answered (the page shows as usual meanwhile).
 */
export function TeamAccessGate() {
  const [g, setG] = useState<GateState | null>(null);
  const [link, setLink] = useState('');
  // The hosted onboarding opens on the team's home with ?setup=<step> (the chip menu, Settings, a shared link).
  const [setupAt, setSetupAt] = useState<ReturnType<typeof setupStepFromUrl>>(null);
  // A guest page answered from the team's published activity: the banner says how recent it is.
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  // Signed out in another tab (this tab reloaded on it): said once, with Sign in back to this page.
  const [signedOutElsewhere] = useState(() => {
    try {
      const on = sessionStorage.getItem(SIGNED_OUT_ELSEWHERE_KEY) === '1';
      sessionStorage.removeItem(SIGNED_OUT_ELSEWHERE_KEY);
      return on;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    let live = true;
    void (async () => {
      const [{ repoContext }, session] = await Promise.all([import('../../../scripts/repo-context'), import('../../../scripts/github-session')]);
      if (!live) return;
      setLink(teamLink(location.origin, studioBase(location.pathname, true)));
      if (document.documentElement.dataset.shell === 'home') setSetupAt(setupStepFromUrl(location.search));
      let email = false;
      // Signed in to a Bridge account that is not on this team: it can ask to join from here (hosted site only).
      let account = false;
      let linkedLogin: string | null = null;
      const asks = isHostedSite();
      const paint = (access: ReturnType<typeof session.currentAccess>) => {
        const r = repoContext();
        const v = session.currentViewer();
        setG({ owner: r.owner, repo: r.repo, login: v?.login ?? null, name: v?.name ?? null, access: access?.state ?? null, repoAdmin: access?.repoAdmin === true || access?.admin === true, email, emailExpired: session.contributeLinkState() === 'expired', asks, account, linked: session.linkedGitHubRole(), linkedLogin });
      };
      // The account's linked GitHub role, read by the server: its own banner (reconnect), never a visitor's.
      void import('../../../scripts/linked-role').then(({ onLinkedRole }) =>
        onLinkedRole((role) => {
          if (!live) return;
          paint(session.currentAccess());
          // The banner names the GitHub account the Bridge account is linked to.
          if (role && !linkedLogin)
            void import('../../../scripts/account-session')
              .then(({ getAccount }) => getAccount())
              .then(({ account: acc }) => {
                linkedLogin = acc?.github?.login ?? null;
                if (live && linkedLogin) paint(session.currentAccess());
              })
              .catch(() => undefined);
        }),
      );
      session.initGitHubConnect(() => paint(session.currentAccess()));
      session.onAccess(paint);
      // Sign in with your email, on real teams whose site has the email server (one GET, shared with the session).
      const r = repoContext();
      const full = `${r.owner}/${r.repo}`;
      if (asks) {
        void import('../../../scripts/account-session').then(async ({ getAccount }) => {
          const a = (await getAccount()).account;
          if (!live || !a) return;
          account = !a.teams.some((t) => t.repo.toLowerCase() === full.toLowerCase());
          linkedLogin = a.github?.login ?? null;
          paint(session.currentAccess());
        });
      }
      if (contributeEligible(full, r.hosted)) {
        const { contributeInfo } = await import('../../../scripts/contribute-session');
        const info = await contributeInfo(full);
        if (!live) return;
        email = info.available;
        paint(session.currentAccess());
      }
    })();
    let stop: (() => void) | null = null;
    void import('../../../scripts/guest-activity').then((m) => {
      if (live) stop = m.onActivityUsed((a) => setUpdatedAt(a.generatedAt));
    });
    return () => {
      live = false;
      stop?.();
    };
  }, []);

  // An older team sign-in address (?signin, from a bookmark or an email): the one sign-in screen of Bridge now.
  useEffect(() => {
    if (new URLSearchParams(location.search).has(SIGN_IN_PARAM)) location.replace(signInHref(withoutSignIn()));
  }, []);

  // The demo greets a guest itself (its demo banner, lib/demo.ts): no guest banner over it.
  const guestOnDemo = g?.access === 'anonymous-public' && isDemoRepo(`${g.owner}/${g.repo}`);
  const stateScreen = g?.access && !guestOnDemo ? accessScreen(g.access, { owner: g.owner, repo: g.repo, login: g.login, link, admin: g.repoAdmin, email: Boolean(g.email), name: knownTeamName(`${g.owner}/${g.repo}`), asks: Boolean(g.asks), account: Boolean(g.account) }) : null;
  // On the team on GitHub, without the GitHub sign-in in this browser: their role, and Reconnect GitHub to make changes.
  const linkedOn = g && !g.login && linkedMember(g.linked) && (!g.access || g.access === 'anonymous-public' || g.access === 'anonymous-unknown');
  const linkedScreen = linkedOn ? reconnectScreen({ owner: g.owner, repo: g.repo, role: g.linked as 'admin' | 'edit', login: g.linkedLogin, name: knownTeamName(`${g.owner}/${g.repo}`), block: g.access === 'anonymous-unknown' }) : null;
  const screen = signedOutElsewhere && g && !g.login ? signedOutScreen(g.owner, g.repo) : (linkedScreen ?? stateScreen);
  const block = screen?.layout === 'block';
  const setup = Boolean(g?.login && setupAt && !block);
  useTakeover(Boolean(block || setup));
  if (!g) return null;
  const emailProps = g.email ? { repo: `${g.owner}/${g.repo}`, emailExpired: Boolean(g.emailExpired) } : {};
  // A link found expired after the screen showed says so: a fresh screen.
  const k = g.emailExpired ? 'expired' : 'ok';
  if (block) return <NoAccess key={k} screen={screen!} {...emailProps} />;
  if (setup)
    return (
      <HostedOnboarding
        gate={g}
        link={link}
        initial={setupAt!}
        onLeave={() => {
          setSetupAt(null);
          const url = new URL(location.href);
          url.searchParams.delete('setup');
          history.replaceState(history.state, '', url);
          window.scrollTo({ top: 0 });
        }}
      />
    );
  return screen ? <NoAccess key={k} screen={screen} updatedAt={g.access === 'anonymous-public' && screen !== linkedScreen ? updatedAt : null} {...emailProps} /> : null;
}
