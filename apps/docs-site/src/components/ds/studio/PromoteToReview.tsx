// Changes > Explorations > detail: the confirmation before "Promote to review". The detail is painted by
// scripts/explorations.ts; its button sends a `bridge:promote-ask` event with what to say and what to do. This island
// shows a DS Dialog that says who will be asked to approve (read before the write, from the rights and owners) and
// what happens next, then runs the promotion. Errors stay in the dialog, with how to fix them.
import { useEffect, useState } from 'react';
import { Alert, Button, ButtonGroup, Dialog, DialogClose, DialogContent } from '@bridge-ds/react';
import type { PromoteAsk } from '../../../lib/explorations-view';

export interface PromoteAskDetail {
  number: number;
  name: string;
  /** Who will be asked and what happens, read from GitHub and the config (no write). */
  ask: () => Promise<PromoteAsk>;
  /** Runs the promotion. Throws with a sentence that says how to fix it. */
  confirm: () => Promise<void>;
  /** Called when the dialog closes, promoted or not: focus goes back to the page. */
  closed: (promoted: boolean) => void;
}

export const PROMOTE_EVENT = 'bridge:promote-ask';

export default function PromoteToReview() {
  const [detail, setDetail] = useState<PromoteAskDetail | null>(null);
  const [ask, setAsk] = useState<PromoteAsk | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<PromoteAskDetail>).detail;
      setDetail(d);
      setAsk(null);
      setError(null);
      setBusy(false);
      d.ask().then(setAsk, () => setAsk({ who: 'The owners set in Settings will be asked to approve.', next: 'It moves to In review. Design and tech approve, then it can be merged.' }));
    };
    document.addEventListener(PROMOTE_EVENT, on);
    return () => document.removeEventListener(PROMOTE_EVENT, on);
  }, []);

  const close = (promoted: boolean) => {
    const d = detail;
    setDetail(null);
    d?.closed(promoted);
  };

  const confirm = async () => {
    if (!detail) return;
    setBusy(true);
    setError(null);
    try {
      await detail.confirm();
      setBusy(false);
      close(true);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <Dialog open={detail !== null} onOpenChange={(o) => !o && !busy && close(false)}>
      <DialogContent
        size="sm"
        title={detail ? `Promote “${detail.name}” to review?` : 'Promote to review?'}
        description={ask?.next ?? 'It moves to In review, then it can be merged once approved.'}
        footer={
          <ButtonGroup align="end">
            <DialogClose render={<Button variant="secondary" disabled={busy} />}>Cancel</DialogClose>
            <Button variant="primary" loading={busy} disabled={busy || ask === null} onClick={() => void confirm()}>
              {busy ? 'Promoting' : 'Promote to review'}
            </Button>
          </ButtonGroup>
        }
      >
        <p className="ex-ask-who" aria-live="polite">
          {ask ? ask.who : 'Reading who will be asked to approve.'}
        </p>
        {error && (
          <Alert tone="danger" className="ex-ask-error">
            {error}
          </Alert>
        )}
      </DialogContent>
    </Dialog>
  );
}
