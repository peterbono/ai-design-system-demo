// What a team's Bridge shows when GitHub does not let the visitor in, or only partly (multi-team plan 7.3), one screen
// per access state (lib/access-view.ts accessScreen):
//   - block: the page content gives way to one Harbor zone with a Field Guide drawing, the title, one paragraph, the
//     one primary action first (Sign in with GitHub, or Ask your lead for access, which copies a ready message), a
//     secondary, quiet links and a note. The nav stays, so the team chip still says where you are.
//   - banner: one DS Banner over a read-only Studio (guest on a public repository, Bridge not set up, outside the team).
// TeamAccessGate mounts it on every team page (layouts/Layout.astro, hosted only) and also opens the hosted
// onboarding there on ?setup=<step> (components/ds/studio/Onboarding.tsx, step 2 hosted states, step Invite your team).
import { useEffect, useState } from 'react';
import '../../../styles/onboarding.css';
import '../../../styles/requests.css';
import { AlertTriangle, Check, Copy, Info, LogOut, Mail } from 'lucide-react';
import { Banner, Button, Dialog, DialogContent, Link } from '@bridge-ds/react';
import type { RepoAccessState } from '@bridge-ds/core';
import ButtonLink from '../ButtonLink';
import { GitHubMark } from './brand-icons';
import { Drawing } from './Drawing';
import { useCopy } from './TeamLink';
import { HostedOnboarding, setupStepFromUrl } from './Onboarding';
import EmailLinkForm from '../library/EmailLinkForm';
import { accessScreen, signInScreen, SIGN_IN_PARAM, teamLink, type AccessAction, type AccessScreen } from '../../../lib/access-view';
import { studioBase } from '../../../lib/team-path';
import { isDemoRepo } from '../../../lib/demo';
import { updatedLine } from '../../../lib/activity-view';
import { CONTRIBUTE_WORDS, contributeEligible } from '../../../lib/contribute';

/** The attributes the shared GitHub session listens for (scripts/github-session.ts). */
const SESSION_ATTRS = {
  signin: { 'data-gh-open': '', 'data-gh-signin': '' },
  signout: { 'data-gh-forget': '' },
} as const;

function ActionButton({ action, variant, copy, copied, onEmail }: { action: AccessAction; variant: 'primary' | 'secondary'; copy: (text: string, done: string) => void; copied: boolean; onEmail?: () => void }) {
  switch (action.kind) {
    case 'email':
      return (
        <Button variant={variant} iconStart={Mail} onClick={onEmail}>
          {action.label}
        </Button>
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

/**
 * Sign in with your email (lib/contribute.ts): the Library gate's email form (EmailLinkForm), sending a link to a
 * team's email contributor. The server answers the same whether or not the address is on the team.
 */
function EmailSignIn({ repo, expired, autoFocus, onSent }: { repo: string; expired: boolean; autoFocus: boolean; onSent: (sent: boolean) => void }) {
  return (
    <EmailLinkForm
      words={CONTRIBUTE_WORDS}
      expired={expired}
      autoFocus={autoFocus}
      onSent={onSent}
      send={async (email) => (await import('../../../scripts/contribute-session')).requestEmailSignIn(repo, email)}
      isUnavailable={(err) => err instanceof Error && err.name === 'ContributeUnavailable'}
      unavailable={<p className="t-body">{CONTRIBUTE_WORDS.unavailable}</p>}
    >
      <p className="t-body">{CONTRIBUTE_WORDS.emailSignInLead}</p>
    </EmailLinkForm>
  );
}

export interface NoAccessProps {
  screen: AccessScreen;
  /** "owner/repo": where Sign in with your email sends its link (screens with the email action). */
  repo?: string;
  /** The visitor opened a sign-in link that expired: the email form opens with the reason. */
  emailExpired?: boolean;
  /** When the page reads the team's published activity (a guest): when it was written, said quietly in the banner. */
  updatedAt?: string | null;
}

/** One access screen: the full block or the banner. */
export function NoAccess({ screen, updatedAt, repo = '', emailExpired = false }: NoAccessProps) {
  const { copied, said, copy } = useCopy(3000);
  // "Invited with your email? Get a sign-in link": on the block, the form replaces Sign in with GitHub in place (its
  // Send me a link becomes the primary, "Use GitHub instead" goes back); on the banner, it opens in a dialog.
  const emailLink = repo ? screen.links?.find((l) => l.action.kind === 'email') : undefined;
  const [emailOpen, setEmailOpen] = useState(emailExpired && Boolean(emailLink));
  const [sent, setSent] = useState(false);
  const email = emailLink ? <EmailSignIn repo={repo} expired={emailExpired} autoFocus={!emailExpired} onSent={setSent} /> : null;
  // While this screen asks to sign in, the side nav's own "Connect GitHub" would be a second call to action: hidden.
  const asksSignIn = screen.layout === 'block' && screen.primary.kind === 'signin';
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

  if (screen.layout === 'banner') {
    return (
      <Banner
        className="na-banner"
        appearance="neutral"
        icon={screen.tone === 'warning' ? AlertTriangle : Info}
        title={screen.title}
        actions={
          <>
            <ActionButton action={screen.primary} variant="secondary" copy={run} copied={copied} />
            {emailLink && (
              <Button variant="link" size="sm" onClick={() => setEmailOpen(true)}>
                {emailLink.action.label}
              </Button>
            )}
          </>
        }
      >
        {screen.body}
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
        {email && (
          <Dialog open={emailOpen} onOpenChange={setEmailOpen}>
            <DialogContent title={sent ? CONTRIBUTE_WORDS.sentTitle : CONTRIBUTE_WORDS.emailSignInTitle} size="sm" className="na-email-dialog">
              {email}
            </DialogContent>
          </Dialog>
        )}
      </Banner>
    );
  }

  const inEmail = Boolean(email && emailOpen);
  return (
    <section className="zone na" aria-labelledby="na-title">
      <div className="na-art" aria-hidden="true">
        <Drawing name="guide" width={112} />
      </div>
      <div className="na-text">
        <h1 id="na-title" className="na-title">
          {sent ? CONTRIBUTE_WORDS.sentTitle : screen.title}
        </h1>
        {!inEmail && <p className="na-body">{screen.body}</p>}
        {!inEmail && (
          <div className="na-actions">
            <ActionButton action={screen.primary} variant="primary" copy={run} copied={copied} />
            {screen.secondary && <ActionButton action={screen.secondary} variant="secondary" copy={run} copied={copied} />}
          </div>
        )}
        {inEmail && (
          <div className="na-email">
            {email}
            {!sent && (
              <p className="na-link">
                <Button variant="link" size="sm" iconStart={GitHubMark} onClick={() => setEmailOpen(false)}>
                  {CONTRIBUTE_WORDS.useGitHubInstead}
                </Button>
              </p>
            )}
          </div>
        )}
        {live}
        {fallback}
        {!inEmail &&
          screen.links?.map((l) =>
            l.action.kind === 'link' ? (
              <p key={l.action.href} className="na-link">
                {l.lead && <span>{l.lead} </span>}
                <Link href={l.action.href} external={l.action.external}>
                  {l.action.label}
                </Link>
              </p>
            ) : l.action.kind === 'email' && email ? (
              <p key="email" className="na-link">
                {l.lead && <span>{l.lead} </span>}
                <Button variant="link" size="sm" onClick={() => setEmailOpen(true)}>
                  {l.action.label}
                </Button>
              </p>
            ) : null,
          )}
        {screen.note && <p className="na-quiet">{screen.note}</p>}
      </div>
    </section>
  );
}

/** This page's address without ?signin: the way back from the sign-in screen. */
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
  access: RepoAccessState | null;
  repoAdmin: boolean;
  /** This site signs email contributors in on this team (real teams only). */
  email?: boolean;
  /** The sign-in link from an email had expired. */
  emailExpired?: boolean;
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
  // The side nav's Sign in asked for the team's sign-in screen (?signin): read from the address, Back included.
  const [signInAsked, setSignInAsked] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      const [{ repoContext }, session] = await Promise.all([import('../../../scripts/repo-context'), import('../../../scripts/github-session')]);
      if (!live) return;
      setLink(teamLink(location.origin, studioBase(location.pathname, true)));
      if (document.documentElement.dataset.shell === 'home') setSetupAt(setupStepFromUrl(location.search));
      let email = false;
      const paint = (access: ReturnType<typeof session.currentAccess>) => {
        const r = repoContext();
        const v = session.currentViewer();
        setG({ owner: r.owner, repo: r.repo, login: v?.login ?? null, access: access?.state ?? null, repoAdmin: access?.repoAdmin === true || access?.admin === true, email, emailExpired: session.contributeLinkState() === 'expired' });
      };
      session.initGitHubConnect(() => paint(session.currentAccess()));
      session.onAccess(paint);
      // Sign in with your email, on real teams whose site has the email server (one GET, shared with the session).
      const r = repoContext();
      const full = `${r.owner}/${r.repo}`;
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

  useEffect(() => {
    const read = () => setSignInAsked(new URLSearchParams(location.search).has(SIGN_IN_PARAM));
    read();
    addEventListener('popstate', read);
    return () => removeEventListener('popstate', read);
  }, []);

  // Signed out on a team that signs email contributors in: the side nav's Sign in ([data-gh-signin-screen]) opens the
  // sign-in screen with both ways in, instead of going straight to GitHub (scripts/github-session.ts). Elsewhere (the
  // sample team, a site without the email server) the click goes on to GitHub as before.
  const offersScreen = Boolean(g?.email && !g.login && !isDemoRepo(`${g.owner}/${g.repo}`));
  useEffect(() => {
    if (!offersScreen) return;
    const onClick = (e: MouseEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest('[data-gh-signin-screen]')) return;
      // Before the shared session's own listener, which would leave for GitHub.
      e.preventDefault();
      e.stopImmediatePropagation();
      // From the phone menu sheet: close it, the screen takes the page.
      if (document.getElementById('rail')?.classList.contains('is-open')) document.getElementById('rail-close')?.click();
      const url = new URL(location.href);
      url.searchParams.set(SIGN_IN_PARAM, '');
      history.pushState(history.state, '', url);
      setSignInAsked(true);
      window.scrollTo({ top: 0 });
    };
    addEventListener('click', onClick, true);
    return () => removeEventListener('click', onClick, true);
  }, [offersScreen]);

  // The demo greets a guest itself (its demo banner, lib/demo.ts): no guest banner over it.
  const guestOnDemo = g?.access === 'anonymous-public' && isDemoRepo(`${g.owner}/${g.repo}`);
  const stateScreen = g?.access && !guestOnDemo ? accessScreen(g.access, { owner: g.owner, repo: g.repo, login: g.login, link, admin: g.repoAdmin, email: Boolean(g.email) }) : null;
  // A screen that already takes the page (a private team asks to sign in) wins over the asked one.
  const asked = offersScreen && signInAsked && g && stateScreen?.layout !== 'block' ? signInScreen({ owner: g.owner, repo: g.repo, back: withoutSignIn() }) : null;
  const screen = asked ?? stateScreen;
  const block = screen?.layout === 'block';
  const setup = Boolean(g?.login && setupAt && !block);
  useTakeover(Boolean(block || setup));
  if (!g) return null;
  const emailProps = g.email ? { repo: `${g.owner}/${g.repo}`, emailExpired: Boolean(g.emailExpired) } : {};
  // A link found expired after the screen showed opens the email form: a fresh screen.
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
  return screen ? <NoAccess key={k} screen={screen} updatedAt={g.access === 'anonymous-public' ? updatedAt : null} {...emailProps} /> : null;
}
