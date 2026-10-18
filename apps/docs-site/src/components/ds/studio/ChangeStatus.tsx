// The status line of a change (Changes > a change): one DS Badge with the lifecycle state (lib/change-status), one
// sentence that says what happens next, and at most one action on the same line (Mark as ready, Reopen this change,
// Start again from this change). Mounted by scripts/change-status.ts into the header that scripts/reviews.ts paints.
import { useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CircleSlash, Eye, Hourglass, PackageCheck, PencilLine } from 'lucide-react';
import { Badge, Button } from '@bridge-ds/react';
import type { Lifecycle, LifecycleTone } from '../../../lib/change-status';

const ICON = { draft: PencilLine, ready: Eye, waiting: Hourglass, shipped: PackageCheck, closed: CircleSlash } as const;

export interface ChangeStatusProps {
  lifecycle: Lifecycle;
  label: string;
  tone: LifecycleTone;
  /** What happens next, in one sentence. */
  sentence: string;
  /** The one action of this state. `run` resolves with the line to say, or rejects with an error that says how to fix. */
  action?: { label: string; run: () => Promise<string | void> } | null;
  /** The viewer reads "Your turn": the sentence is the call to action. */
  yourTurn?: boolean;
  /** A line to announce on mount: the result of the action that repainted the change. */
  said?: string;
}

export function ChangeStatus({ lifecycle, label, tone, sentence, action, yourTurn, said: first = '' }: ChangeStatusProps) {
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState(first);
  const go = async () => {
    if (!action) return;
    setBusy(true);
    setSaid('');
    try {
      setSaid((await action.run()) ?? '');
    } catch (err) {
      setSaid((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="cs-line" data-lifecycle={lifecycle}>
        <div className="cs-what">
          <Badge tone={tone} icon={ICON[lifecycle]}>
            {label}
          </Badge>
          <p className="cs-sentence" data-who={yourTurn ? 'you' : undefined}>
            {sentence}
          </p>
        </div>
        {action && (
          <Button variant="primary" loading={busy} disabled={busy} onClick={() => void go()} className="cs-act">
            {action.label}
          </Button>
        )}
      </div>
      <p className="cs-said" role="status" aria-live="polite">
        {said}
      </p>
    </>
  );
}

/** Renders the status line into `el`; call `unmount()` before the detail is repainted. */
export function mountChangeStatus(el: HTMLElement, props: ChangeStatusProps): Root {
  const root = createRoot(el);
  root.render(<ChangeStatus {...props} />);
  return root;
}
