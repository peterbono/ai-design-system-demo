// The gate of a team's Library (Settings, Library access): what a visitor sees before the Library when its team chose
// "Anyone with a work email at ..." or "Only the team" (the email form is EmailLinkForm.tsx, shared with a team's email
// sign-in). One calm screen, the page's one Harbor zone, one primary action:
//   email        "Enter your work email" and Send me a link; then "Check your inbox" (the address masked). A wrong
//                domain is said on the field ("This library is open to @acme.design emails. Ask your design system
//                team for access."), an expired link above it, a site without email sign-in instead of the form.
//   team         "This library is open to its team" and Sign in from Studio (GitHub).
// useLibraryGate decides (lib/library-access.ts libraryGate) from the server's answer (scripts/library-access-api.ts):
// the sample team and a site without the feature never ask anything and open as before. The link from the email lands
// here with #signin=<token>: the token leaves the address at once, then is spent on the server, which sets the
// session cookie (httpOnly, never seen by this page).
import { useEffect, useState } from 'react';
import ButtonLink from '../ButtonLink';
import EmailLinkForm from './EmailLinkForm';
import { GitHubMark } from '../studio/brand-icons';
import { Drawing } from '../studio/Drawing';
import { emailDomainIn, GATE_WORDS, libraryGate, signInToken, wrongDomainWords, type AccessAnswer } from '../../../lib/library-access';
import { isSampleTeam } from '../../../lib/demo';
import { teamHref } from '../../../lib/team-path';
import { teamDisplayName } from '../../../lib/demo';
import '../../../styles/library-access.css';

export type GateState =
  | { step: 'checking' }
  | { step: 'open'; answer: AccessAnswer | null }
  | { step: 'email'; domains: string[]; expired?: boolean }
  | { step: 'team' }
  | { step: 'unavailable' };

/** What the Library page shows this visitor (see the top of this file). */
export function useLibraryGate(team: { owner: string; repo: string } | null): GateState {
  const [state, setState] = useState<GateState>({ step: 'checking' });
  useEffect(() => {
    if (!team) return;
    const repo = `${team.owner}/${team.repo}`;
    let live = true;
    void (async () => {
      const [{ hasWorkingToken }, api, { openLibrary }] = await Promise.all([import('../../../scripts/github-session'), import('../../../scripts/library-access-api'), import('../../../scripts/team-data')]);
      // The sample team never asks the server: its Library stays open, with no call at all.
      if (isSampleTeam(repo)) {
        openLibrary(false);
        if (live) setState({ step: 'open', answer: null });
        return;
      }
      const token = signInToken(location.hash);
      let expired = false;
      let unavailable = false;
      if (token) {
        // Out of the address before anything else: never in the history, a bookmark or a shared link.
        history.replaceState(history.state, '', location.pathname + location.search);
        try {
          await api.verifySignIn(repo, token);
        } catch (err) {
          if (err instanceof api.AccessUnavailable) unavailable = true;
          else expired = true;
        }
      }
      const answer = await api.libraryAccess(repo, Boolean(token));
      if (!live) return;
      if (unavailable && !answer.available) return setState({ step: 'unavailable' });
      const kind = libraryGate({ sample: false, github: hasWorkingToken(), answer });
      if (kind === 'open' || kind === 'open-bridge') openLibrary(kind === 'open-bridge');
      if (kind === 'email') setState({ step: 'email', domains: answer.setting?.domains ?? [], ...(expired ? { expired } : {}) });
      else if (kind === 'team') setState({ step: 'team' });
      else setState({ step: 'open', answer });
    })();
    return () => {
      live = false;
    };
  }, [team?.owner, team?.repo]);
  return state;
}

/**
 * The email gate a visitor signed in with GitHub falls back to when GitHub does not show them the repository: they
 * may still read it with their work email. Null when the Library does not open with an email.
 */
export function emailFallback(answer: AccessAnswer | null): string[] | null {
  return answer?.available && answer.setting?.mode === 'email' && !answer.session ? answer.setting.domains : null;
}

function Zone({ repo, title, children }: { repo: string; title: string; children: React.ReactNode }) {
  return (
    <section className="zone lgt" aria-labelledby="lgt-title">
      <div className="lgt-copy">
        <p className="ltm-eyebrow">{teamDisplayName(repo)}</p>
        <h1 id="lgt-title" className="t-display lgt-title">
          {title}
        </h1>
        {children}
      </div>
      <Drawing name="guide" width={160} className="lgt-art" />
    </section>
  );
}

function EmailGate({ repo, domains, expired }: { repo: string; domains: string[]; expired: boolean }) {
  const [sent, setSent] = useState(false);
  const unavailableText = (
    <p className="t-body">
      {GATE_WORDS.unavailable} {GATE_WORDS.unavailableText}
    </p>
  );
  return (
    <Zone repo={repo} title={sent ? GATE_WORDS.sentTitle : GATE_WORDS.title}>
      <EmailLinkForm
        words={GATE_WORDS}
        expired={expired}
        onSent={setSent}
        check={(email) => (emailDomainIn(email, domains) ? null : wrongDomainWords(domains))}
        send={async (email) => (await import('../../../scripts/library-access-api')).requestSignIn(repo, email)}
        isUnavailable={(err) => err instanceof Error && err.name === 'AccessUnavailable'}
        unavailable={unavailableText}
      >
        <p className="t-body">{GATE_WORDS.emailLead(domains)}</p>
      </EmailLinkForm>
    </Zone>
  );
}

/** The gate screen for a state that is not open. */
export default function LibraryGate({ team, state }: { team: { owner: string; repo: string }; state: Exclude<GateState, { step: 'checking' } | { step: 'open' }> }) {
  const repo = `${team.owner}/${team.repo}`;
  if (state.step === 'email') return <EmailGate repo={repo} domains={state.domains} expired={Boolean(state.expired)} />;
  if (state.step === 'unavailable')
    return (
      <Zone repo={repo} title={GATE_WORDS.title}>
        <p className="t-body">
          {GATE_WORDS.unavailable} {GATE_WORDS.unavailableText}
        </p>
      </Zone>
    );
  return (
    <Zone repo={repo} title={GATE_WORDS.teamTitle}>
      <p className="t-body">{GATE_WORDS.teamText}</p>
      <div className="lgt-actions">
        <ButtonLink variant="primary" size="lg" href={teamHref(team.owner, team.repo, null)} iconStart={GitHubMark}>
          {GATE_WORDS.teamAction}
        </ButtonLink>
      </div>
    </Zone>
  );
}
