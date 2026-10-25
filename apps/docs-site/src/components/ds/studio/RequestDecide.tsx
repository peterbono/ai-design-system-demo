// Changes > Requests > detail: Assign someone and Decline, from the decision zone. The detail is painted by
// scripts/requests.ts (Decline serves suggestions too, scripts/suggestions.ts); its buttons send a `bridge:request-assign` or `bridge:request-decline` event with what to say
// and what to do (the GitHub calls stay in the script, with the viewer's own token). Assign shows a DS Combobox of the
// people who can push, in place; Decline a DS Dialog with a required reason that says who reads it. Errors stay next
// to the action, with how to fix them.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Alert, Button, ButtonGroup, Combobox, Dialog, DialogClose, DialogContent, Textarea } from '@bridge-ds/react';

export interface AssignAskDetail {
  number: number;
  title: string;
  /** People who can push, read from GitHub with the viewer's token. Throws with a sentence that says how to fix it. */
  people: () => Promise<{ value: string; label: string; description?: string }[]>;
  /** Where the choice shows: the decision zone of the request. */
  slot: HTMLElement;
  /** Assigns them. Throws with a sentence that says how to fix it. */
  confirm: (login: string) => Promise<void>;
  closed: (done: boolean) => void;
}

export interface DeclineAskDetail {
  number: number;
  title: string;
  /** Who reads the reason, and where: "@ana gets a GitHub notification with your reason". */
  audience: string;
  /** Problems with the reason (empty when it can be sent). */
  problems: (reason: string) => string[];
  /** Posts the reason and closes the request. Throws with a sentence that says how to fix it. */
  confirm: (reason: string) => Promise<void>;
  closed: (done: boolean) => void;
  /** What is declined, in the title and on the button: "request" (default) or "suggestion" (scripts/suggestions.ts). */
  noun?: 'request' | 'suggestion';
}

export const ASSIGN_EVENT = 'bridge:request-assign';
export const DECLINE_EVENT = 'bridge:request-decline';

/**
 * Assign someone, inline in the decision zone (createPortal into the slot the script gives): the DS Combobox lists
 * its options in a popup that a Dialog would cover, so the choice happens on the page, next to what it acts on.
 */
function AssignInline() {
  const [detail, setDetail] = useState<AssignAskDetail | null>(null);
  const [people, setPeople] = useState<{ value: string; label: string; description?: string }[] | null>(null);
  const [value, setValue] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<AssignAskDetail>).detail;
      setDetail(d);
      setPeople(null);
      setValue(null);
      setError(null);
      setBusy(false);
      d.people().then(setPeople, (err: Error) => {
        setPeople([]);
        setError(err.message);
      });
    };
    document.addEventListener(ASSIGN_EVENT, on);
    return () => document.removeEventListener(ASSIGN_EVENT, on);
  }, []);

  const close = (done: boolean) => {
    const d = detail;
    setDetail(null);
    d?.closed(done);
  };

  const confirm = async () => {
    if (!detail || !value) return;
    setBusy(true);
    setError(null);
    try {
      await detail.confirm(value);
      setBusy(false);
      close(true);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  if (!detail || !detail.slot.isConnected) return null;
  return createPortal(
    <div className="rq-assign">
      <div className="rq-assign-row">
        <div className="rq-assign-person">
          <Combobox
            label="Who should work on it?"
            placeholder="Search people who can edit the library"
            options={people ?? []}
            loading={people === null}
            loadingMessage="Reading who can edit the library"
            emptyMessage="Nobody matches. Only people who can edit the repository can be assigned."
            value={value}
            onValueChange={(v) => setValue(typeof v === 'string' ? v : null)}
            autoFocus
          />
        </div>
        <ButtonGroup>
          <Button variant="primary" loading={busy} disabled={busy || !value} onClick={() => void confirm()}>
            {busy ? 'Assigning' : 'Assign'}
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => close(false)}>
            Cancel
          </Button>
        </ButtonGroup>
      </div>
      {error && (
        <Alert tone="danger" className="ex-ask-error">
          {error}
        </Alert>
      )}
    </div>,
    detail.slot
  );
}

function DeclineDialog() {
  const [detail, setDetail] = useState<DeclineAskDetail | null>(null);
  const [reason, setReason] = useState('');
  const [invalid, setInvalid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const on = (e: Event) => {
      setDetail((e as CustomEvent<DeclineAskDetail>).detail);
      setReason('');
      setInvalid(null);
      setError(null);
      setBusy(false);
    };
    document.addEventListener(DECLINE_EVENT, on);
    return () => document.removeEventListener(DECLINE_EVENT, on);
  }, []);

  const close = (done: boolean) => {
    const d = detail;
    setDetail(null);
    d?.closed(done);
  };

  const confirm = async () => {
    if (!detail) return;
    const problems = detail.problems(reason);
    if (problems.length) {
      setInvalid(problems.join(' '));
      field.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await detail.confirm(reason);
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
        title={`Decline this ${detail?.noun ?? 'request'}?`}
        description={detail?.audience}
        initialFocus={field}
        footer={
          <ButtonGroup align="end">
            <DialogClose render={<Button variant="secondary" disabled={busy} />}>Keep it</DialogClose>
            <Button variant="danger" loading={busy} disabled={busy} onClick={() => void confirm()}>
              {busy ? 'Declining' : `Decline ${detail?.noun ?? 'request'}`}
            </Button>
          </ButtonGroup>
        }
      >
        <Textarea
          ref={field}
          label="Reason"
          required
          rows={3}
          hint="Say why, and what to use instead if something exists."
          error={invalid ?? undefined}
          value={reason}
          onValueChange={(v) => {
            setReason(v);
            setInvalid(null);
          }}
        />
        {error && (
          <Alert tone="danger" className="ex-ask-error">
            {error}
          </Alert>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function RequestDecide() {
  return (
    <>
      <AssignInline />
      <DeclineDialog />
    </>
  );
}
