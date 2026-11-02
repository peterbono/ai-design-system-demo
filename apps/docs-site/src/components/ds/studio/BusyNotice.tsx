// GitHub is busy for the viewer (lib/github-busy.ts): one calm notice where the content would be, never "not found",
// "empty" or "Make my copy". Two shapes:
//   - kept: the last known content stays on screen; one quiet line above it says when Bridge is back, with Try again.
//   - alone (nothing kept): a calm Field Guide moment in place of the content, the same sentence and Try again.
// Either way the page reads again once on its own, just after GitHub's reset (useBusyRetry). Designer words only.
import { useEffect, useRef } from 'react';
import { Button } from '@bridge-ds/react';
import { Drawing } from './Drawing';
import { BUSY_RETRY, busyLine, busyRetryDelay, type GitHubBusy } from '../../../lib/github-busy';
import '../../../styles/busy-notice.css';

/** Calls `onRetry` once, just after `busy` resets (a new wait starts a new timer). Nothing while not busy. */
export function useBusyRetry(busy: GitHubBusy | null | undefined, onRetry: () => void): void {
  const retry = useRef(onRetry);
  retry.current = onRetry;
  const at = busy ? (busy.resetsAt?.getTime() ?? 0) : null;
  useEffect(() => {
    if (!busy) return;
    const t = setTimeout(() => retry.current(), busyRetryDelay(busy));
    return () => clearTimeout(t);
    // One timer per wait: the same reset time keeps the timer it has.
  }, [at]);
}

export interface BusyNoticeProps {
  busy: GitHubBusy;
  /** Reads again (Try again, and once on its own after the reset). */
  onRetry: () => void;
  /** The last known content stays on screen: one quiet line instead of the calm moment. */
  kept?: boolean;
  /** Signed out: "GitHub is busy right now." instead of "for your account". */
  signedIn?: boolean;
}

export function BusyNotice({ busy, onRetry, kept = false, signedIn = true }: BusyNoticeProps) {
  useBusyRetry(busy, onRetry);
  const line = busyLine(busy, { signedIn });
  if (kept) {
    return (
      <p className="t-ui t-muted busy-line" role="status" data-busy="kept">
        <span>{line}</span>{' '}
        <Button variant="link" size="sm" onClick={onRetry}>
          {BUSY_RETRY}
        </Button>
      </p>
    );
  }
  return (
    <section className="zone busy-moment" aria-label={line} data-busy="alone">
      <Drawing name="guide" width={120} />
      <div className="busy-moment-text">
        <p className="t-body" role="status">
          {line}
        </p>
        <Button variant="secondary" onClick={onRetry}>
          {BUSY_RETRY}
        </Button>
      </div>
    </section>
  );
}
