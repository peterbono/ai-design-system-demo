// "Done exploring" (decision 2026-10-30), on an exploration page and on a product branch page: the pages send a
// `bridge:done-exploring-ask` event with the pieces the last check found and what to do. This island shows a DS Dialog
// that says nothing closes, lists the new pieces for the library as checkboxes (each one ticked goes to the DS lead as
// a request with a link to the preview, unticked ones are not proposed), then runs it. Errors stay in the dialog.
// Replaces "Promote to review": the exploration stays open, its preview link alive, and goes to the developers.
import { useEffect, useState } from 'react';
import { Alert, Button, ButtonGroup, Checkbox, CheckboxGroup, Dialog, DialogClose, DialogContent, Spinner } from '@bridge-ds/react';
import { doneExploringCopy, type DonePiece } from '../../../lib/explorations-view';

export interface DoneExploringDetail {
  number: number;
  name: string;
  /** The pieces the last check found with no library side yet; `checked` false: never checked. */
  pieces: DonePiece[];
  checked: boolean;
  /** Pieces already sent to the library before. */
  sent: number;
  /** Runs it with the ticked piece ids. Throws with a sentence that says how to fix it. */
  confirm: (pieces: string[]) => Promise<void>;
  /** Called when the dialog closes, done or not: focus goes back to the page. */
  closed: (done: boolean) => void;
  /**
   * Never checked: Bridge checks it against the library while the dialog is open (the server runs the audit), then
   * the pieces it found are offered. Null when it cannot run for this viewer; the dialog then goes on without pieces.
   */
  check?: (() => Promise<Pick<DoneExploringDetail, 'pieces' | 'checked' | 'sent'> | null>) | null;
}

export const DONE_EVENT = 'bridge:done-exploring-ask';

export default function DoneExploring() {
  const [detail, setDetail] = useState<DoneExploringDetail | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<DoneExploringDetail>).detail;
      setDetail(d);
      // The designer found them missing: every new piece starts ticked, unticking one leaves it out.
      setPicked(d.pieces.map((p) => p.id));
      setError(null);
      setBusy(false);
      setChecking(false);
      if (!d.checked && d.check) {
        setChecking(true);
        d.check()
          .then((found) => {
            if (!found) return;
            setDetail((cur) => (cur === d ? { ...d, ...found } : cur));
            setPicked(found.pieces.map((p) => p.id));
          })
          .catch(() => {})
          .finally(() => setChecking(false));
      }
    };
    document.addEventListener(DONE_EVENT, on);
    return () => document.removeEventListener(DONE_EVENT, on);
  }, []);

  const close = (done: boolean) => {
    const d = detail;
    setDetail(null);
    d?.closed(done);
  };

  const confirm = async () => {
    if (!detail) return;
    setBusy(true);
    setError(null);
    try {
      await detail.confirm(picked);
      setBusy(false);
      close(true);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const copy = detail ? doneExploringCopy({ checked: detail.checked, pieces: detail.pieces.length, sent: detail.sent, canCheck: Boolean(detail.check) }) : null;
  return (
    <Dialog open={detail !== null} onOpenChange={(o) => !o && !busy && close(false)}>
      <DialogContent
        size="sm"
        title={detail ? `Done exploring “${detail.name}”?` : 'Done exploring?'}
        description={copy?.description}
        footer={
          <ButtonGroup align="end">
            <DialogClose render={<Button variant="secondary" disabled={busy} />}>Cancel</DialogClose>
            <Button variant="primary" loading={busy} disabled={busy || checking} onClick={() => void confirm()}>
              {busy ? 'Saving' : 'Done exploring'}
            </Button>
          </ButtonGroup>
        }
      >
        {checking ? (
          <p className="ex-ask-who ex-done-checking" role="status">
            <Spinner size="sm" />
            Bridge is checking what the library is missing.
          </p>
        ) : detail && detail.pieces.length > 0 ? (
          <CheckboxGroup label="Propose to your DS lead" description={copy?.piecesLine} value={picked} onValueChange={setPicked} className="ex-done-pieces">
            {detail.pieces.map((p) => (
              <Checkbox key={p.id} value={p.id} label={p.title} description={p.summary} />
            ))}
          </CheckboxGroup>
        ) : (
          copy?.piecesLine && <p className="ex-ask-who">{copy.piecesLine}</p>
        )}
        {error && (
          <Alert tone="danger" className="ex-ask-error">
            {error}
          </Alert>
        )}
      </DialogContent>
    </Dialog>
  );
}
