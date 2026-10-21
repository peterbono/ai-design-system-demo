// "Make it yours": what a visitor exploring the demo sees when they try to change it (Create branch, New brand,
// Send suggestion, Approve, Start an exploration, a token edit sent for review...). A calm DS Dialog, never an
// error: the demo is for looking around, and changes belong in the visitor's own design system. Two steps, in the
// words of the onboarding (lib/onboarding.ts STEP_TITLE, components/ds/studio/Onboarding.tsx): Sign in with GitHub,
// then Connect your design system, which opens "Create a new team" (NewTeamDialog.tsx, the same field as the
// launcher on Studio home). "Keep exploring" closes it. Words in lib/demo.ts; when it opens: scripts/demo-gate.ts.
import { useState } from 'react';
import { ArrowRight, Check } from 'lucide-react';
import { Button, ButtonGroup, Dialog, DialogClose, DialogContent, Icon } from '@bridge-ds/react';
import { GitHubMark } from './brand-icons';
import NewTeamDialog, { type TeamAccessCheck } from './NewTeamDialog';
import { DEMO_WORDS, makeItYoursLead } from '../../../lib/demo';
import { ghButton } from '../../../lib/gh-wording';
import '../../../styles/onboarding.css';
import '../../../styles/demo-home.css';

export interface MakeItYoursProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What the visitor tried to do, "to <action>": "create branches". */
  action?: string | null;
  /** The GitHub login when signed in (step 1 is done). */
  login: string | null;
  /** The site signs in with GitHub (else the token paste: "Connect GitHub"). */
  signIn: boolean;
  /** The access check of "Create a new team"; leave it out to skip its live line. */
  check?: TeamAccessCheck;
}

/** The demo's onboarding dialog, then "Create a new team" on Connect your design system. */
export function MakeItYours({ open, onOpenChange, action, login, signIn, check }: MakeItYoursProps) {
  const [connecting, setConnecting] = useState(false);
  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="miy"
          title={DEMO_WORDS.dialogTitle}
          description={makeItYoursLead(action)}
          footer={
            <ButtonGroup align="end" className="miy-actions">
              <DialogClose render={<Button variant="secondary" />}>{DEMO_WORDS.keepExploring}</DialogClose>
              <Button
                variant="primary"
                iconEnd={ArrowRight}
                onClick={() => {
                  onOpenChange(false);
                  setConnecting(true);
                }}
              >
                {DEMO_WORDS.connect}
              </Button>
            </ButtonGroup>
          }
        >
          <ol className="miy-steps" aria-label="Two steps">
            <li className="miy-step">
              <span className="onb-mark" data-state={login ? 'done' : 'current'} aria-hidden="true">
                {login ? <Icon icon={Check} size="xs" /> : 1}
              </span>
              <span className="onb-step-text">
                <span className="onb-step-title">{DEMO_WORDS.stepSignIn}</span>
                <span className="onb-step-detail">{login ? `Signed in as @${login}` : DEMO_WORDS.stepSignInLine}</span>
              </span>
              {!login && (
                <Button variant="secondary" iconStart={GitHubMark} className="miy-signin" data-gh-open="" data-gh-signin={signIn ? '' : undefined} onClick={() => onOpenChange(false)}>
                  {signIn ? 'Sign in' : ghButton(false)}
                </Button>
              )}
            </li>
            <li className="miy-step">
              <span className="onb-mark" data-state={login ? 'current' : undefined} aria-hidden="true">
                2
              </span>
              <span className="onb-step-text">
                <span className="onb-step-title">{DEMO_WORDS.stepConnect}</span>
                <span className="onb-step-detail">{DEMO_WORDS.stepConnectLine}</span>
              </span>
            </li>
          </ol>
        </DialogContent>
      </Dialog>
      <NewTeamDialog open={connecting} onOpenChange={setConnecting} signedIn={Boolean(login)} check={check} />
    </>
  );
}

/** The access check "Create a new team" shows as you type: the session's resolver, anonymous when signed out. */
export const teamAccessCheck: TeamAccessCheck = async (o, r) => {
  const { resolveAccess } = await import('../../../scripts/github-session');
  const a = await resolveAccess({ owner: o, repo: r }, { anonymous: true, probe: true });
  return a && { state: a.state, repoAdmin: a.repoAdmin };
};
