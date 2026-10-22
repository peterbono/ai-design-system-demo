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
import { AlertTriangle, Check, Copy, Info, LogOut } from 'lucide-react';
import { Banner, Button, Link } from '@bridge-ds/react';
import type { RepoAccessState } from '@bridge-ds/core';
import ButtonLink from '../ButtonLink';
import { GitHubMark } from './brand-icons';
import { Drawing } from './Drawing';
import { useCopy } from './TeamLink';
import { HostedOnboarding, setupStepFromUrl } from './Onboarding';
import { accessScreen, teamLink, type AccessAction, type AccessScreen } from '../../../lib/access-view';
import { studioBase } from '../../../lib/team-path';
import { updatedLine } from '../../../lib/activity-view';

/** The attributes the shared GitHub session listens for (scripts/github-session.ts). */
const SESSION_ATTRS = {
  signin: { 'data-gh-open': '', 'data-gh-signin': '' },
  signout: { 'data-gh-forget': '' },
} as const;

function ActionButton({ action, variant, copy, copied }: { action: AccessAction; variant: 'primary' | 'secondary'; copy: (text: string, done: string) => void; copied: boolean }) {
  switch (action.kind) {
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
  /** When the page reads the team's published activity (a guest): when it was written, said quietly in the banner. */
  updatedAt?: string | null;
}

/** One access screen: the full block or the banner. */
export function NoAccess({ screen, updatedAt }: NoAccessProps) {
  const { copied, said, copy } = useCopy(3000);
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
        actions={<ActionButton action={screen.primary} variant="secondary" copy={run} copied={copied} />}
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
          ) : null,
        )}
        {screen.note && <p className="na-quiet">{screen.note}</p>}
      </div>
    </section>
  );
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

  useEffect(() => {
    let live = true;
    void (async () => {
      const [{ repoContext }, session] = await Promise.all([import('../../../scripts/repo-context'), import('../../../scripts/github-session')]);
      if (!live) return;
      setLink(teamLink(location.origin, studioBase(location.pathname, true)));
      if (document.documentElement.dataset.shell === 'home') setSetupAt(setupStepFromUrl(location.search));
      const paint = (access: ReturnType<typeof session.currentAccess>) => {
        const r = repoContext();
        const v = session.currentViewer();
        setG({ owner: r.owner, repo: r.repo, login: v?.login ?? null, access: access?.state ?? null, repoAdmin: access?.repoAdmin === true || access?.admin === true });
      };
      session.initGitHubConnect(() => paint(session.currentAccess()));
      session.onAccess(paint);
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

  const screen = g?.access ? accessScreen(g.access, { owner: g.owner, repo: g.repo, login: g.login, link, admin: g.repoAdmin }) : null;
  const block = screen?.layout === 'block';
  const setup = Boolean(g?.login && setupAt && !block);
  useTakeover(Boolean(block || setup));
  if (!g) return null;
  if (block) return <NoAccess screen={screen!} />;
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
  return screen ? <NoAccess screen={screen} updatedAt={g.access === 'anonymous-public' ? updatedAt : null} /> : null;
}
