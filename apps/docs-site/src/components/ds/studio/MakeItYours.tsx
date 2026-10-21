// A write action on the demo (board D2, "a write action asks to sign in"): Create branch, New brand, Send suggestion,
// Approve, Start an exploration, a token edit sent for review... A calm DS Dialog, never an error: in the demo
// nothing is saved, and doing it for real starts with GitHub. "Keep exploring" closes it; "Sign in with GitHub" signs
// in (the shared session listens for data-gh-signin, scripts/github-session.ts). Words in lib/demo.ts; when it opens:
// scripts/demo-gate.ts. Using your own design system is the banner's "Use your own repo" (DemoBanner.tsx).
import { Eye } from 'lucide-react';
import { Alert, Button, ButtonGroup, Dialog, DialogClose, DialogContent } from '@bridge-ds/react';
import { GitHubMark } from './brand-icons';
import { DEMO_WORDS } from '../../../lib/demo';
import { ghButton } from '../../../lib/gh-wording';
import '../../../styles/demo-home.css';

export interface MakeItYoursProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The site signs in with GitHub (else the token paste: "Connect GitHub"). */
  signIn: boolean;
}

/** The demo's write-action dialog. */
export function MakeItYours({ open, onOpenChange, signIn }: MakeItYoursProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="miy"
        title={<span className="miy-title">{DEMO_WORDS.dialogTitle}</span>}
        description={DEMO_WORDS.dialogLead}
        footer={
          <ButtonGroup align="end" className="miy-actions">
            <DialogClose render={<Button variant="secondary" />}>{DEMO_WORDS.keepExploring}</DialogClose>
            <Button variant="primary" iconStart={GitHubMark} data-gh-open="" data-gh-signin={signIn ? '' : undefined} onClick={() => onOpenChange(false)}>
              {ghButton(signIn)}
            </Button>
          </ButtonGroup>
        }
      >
        <Alert tone="neutral" icon={Eye}>
          {DEMO_WORDS.dialogNote}
        </Alert>
      </DialogContent>
    </Dialog>
  );
}
