// "Connect Bridge to your Claude first": what "Continue in Claude" and "Check in Claude" open while the viewer's own
// Claude has no Bridge yet (scripts/claude-link.ts read it). The two steps of Settings > Claude, the address with Copy
// address on its row, a link to Claude's connectors, one quiet line for Claude Team and Enterprise, and "I've
// connected it, continue", which opens the new Claude conversation with the line as before. DS Dialog and Buttons.
// Words: lib/claude-connector.ts. Styles: styles/exploration-page.css (.xp-cc-*: the dialog renders in a portal).
import { useState } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { Button, ButtonGroup, Dialog, DialogClose, DialogContent } from '@bridge-ds/react';
import { CONNECT_FIRST as C, CONNECTOR_WORDS as W } from '../../../lib/claude-connector';

export interface ConnectClaudeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The connector address of this site (<origin>/mcp). */
  address: string;
  /** Where "I've connected it, continue" goes: the new Claude conversation with the line. */
  continueHref: string;
  onContinue: () => void;
  onCopy: (text: string) => Promise<void>;
}

export function ConnectClaudeDialog({ open, onOpenChange, address, continueHref, onContinue, onCopy }: ConnectClaudeDialogProps) {
  const [copied, setCopied] = useState<'yes' | 'failed' | null>(null);
  const copy = () => onCopy(address).then(() => setCopied('yes'), () => setCopied('failed'));
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setCopied(null);
        onOpenChange(o);
      }}
    >
      <DialogContent
        title={C.title}
        description={C.intro}
        className="xp-cc"
        footer={
          <ButtonGroup align="end">
            <DialogClose render={<Button variant="secondary" />}>{C.later}</DialogClose>
            <Button
              variant="primary"
              render={<a href={continueHref} target="_blank" rel="noopener" />}
              onClick={() => {
                onContinue();
                onOpenChange(false);
              }}
            >
              {C.continue}
            </Button>
          </ButtonGroup>
        }
      >
        <ol className="xp-cc-steps">
          <li>
            <p>{W.step1}</p>
            <div className="xp-cc-address">
              <code className="xp-cc-url" aria-label={W.address}>
                {address}
              </code>
              <Button variant="secondary" data-density="compact" iconStart={copied === 'yes' ? Check : Copy} onClick={() => void copy()}>
                {copied === 'yes' ? W.copied : W.copy}
              </Button>
            </div>
            {copied === 'failed' && <p className="xp-cc-quiet">Select the address and copy it.</p>}
            <Button variant="secondary" iconEnd={ExternalLink} className="xp-cc-open" render={<a href={C.connectorsUrl} target="_blank" rel="noopener" />}>
              {C.open}
            </Button>
          </li>
          <li>
            <p>{W.step2}</p>
          </li>
        </ol>
        <p className="xp-cc-quiet">{W.orgAdmins}</p>
        <p className="sr-only" role="status" aria-live="polite">
          {copied === 'yes' ? W.copied : ''}
        </p>
      </DialogContent>
    </Dialog>
  );
}
