// "Share with a product team" on a change (Changes > a change, next to "Try it in the product"): a ready-to-paste
// message for a developer of a product team, with the preview install command the Preview packages workflow posted
// for the latest update, never a guessed one. DS Button, Dialog and Textarea, mounted by scripts/reviews.ts.
// Words and rules: lib/share-change.ts.
import { useEffect, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Share2 } from 'lucide-react';
import { Button, ButtonGroup, Dialog, DialogClose, DialogContent, Textarea } from '@bridge-ds/react';
import { mailtoHref, shareDescription, shareMessage, stateSentence, type ShareMessageInput } from '../../../lib/share-change';

export interface ShareChangeProps extends Omit<ShareMessageInput, 'tryUrl'> {
  /** Read when the dialog opens: "Try it in the product" points at the screen that changes most once it is known. */
  tryUrl: () => string | null;
  /** Controlled open state, when another control opens it (a menu item). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** No button of its own: the dialog opens from `open`. */
  hideTrigger?: boolean;
}

export function ShareChange({ tryUrl, open: openProp, onOpenChange, hideTrigger = false, ...rest }: ShareChangeProps) {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (o: boolean) => {
    setOpenState(o);
    onOpenChange?.(o);
  };
  const [text, setText] = useState('');
  const [said, setSaid] = useState('');
  const message = open ? shareMessage({ ...rest, tryUrl: tryUrl() }) : null;
  const finished = rest.state.kind === 'shipped' || rest.state.kind === 'closed';
  // Once finished, where it stands is the description; before, the explanation is, and the state follows it.
  const sentence = finished ? null : stateSentence(rest.state);
  const copyRef = useRef<HTMLButtonElement>(null);

  // Fresh message on each open: the designer's edits are for one send.
  useEffect(() => {
    if (open) {
      setText(message?.body ?? '');
      setSaid('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setSaid('Message copied. Paste it where the product team talks.');
    } catch {
      setSaid('Copy is not available in this browser. Select the message and copy it with your keyboard.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!hideTrigger && (
        <Button variant="secondary" iconStart={Share2} onClick={() => setOpen(true)}>
          Share with a product team
        </Button>
      )}
      <DialogContent
        title="Share with a product team"
        description={shareDescription(rest.state)}
        size="lg"
        // The message is ready as is: focus lands on Copy, not in the text.
        initialFocus={message ? copyRef : undefined}
        footer={
          message ? (
            <ButtonGroup align="end">
              <Button variant="secondary" render={<a href={mailtoHref({ subject: message.subject, body: text })} />}>
                Open in email
              </Button>
              <Button ref={copyRef} variant="primary" onClick={() => void copy()}>
                Copy message
              </Button>
            </ButtonGroup>
          ) : (
            <ButtonGroup align="end">
              <DialogClose render={<Button variant="secondary" />}>Close</DialogClose>
            </ButtonGroup>
          )
        }
      >
        {sentence && <p className="sh-state">{sentence}</p>}
        {message && (
          <Textarea
            label="Message for a developer"
            hint="Edit it if you like, then copy it or open it in your email."
            value={text}
            onValueChange={setText}
            rows={8}
            maxRows={14}
            className="sh-message"
          />
        )}
        <p className="sh-said" role="status" aria-live="polite">
          {said}
        </p>
      </DialogContent>
    </Dialog>
  );
}

/** Renders into `el`; call `unmount()` on the result before the detail is repainted. */
export function mountShareChange(el: HTMLElement, props: ShareChangeProps): Root {
  const root = createRoot(el);
  root.render(<ShareChange {...props} />);
  return root;
}
