// Bridge made the designers' copy, but Bridge may open only the products ticked on GitHub, and GitHub does not tick a new
// copy on its own (scripts/design-copy.ts makeCopy answers CopyAccess). One more step, in designer words: one sentence,
// "Open GitHub" opens the account's list in a small centered window, and Bridge waits with a Field Guide drawing,
// reading the list every few seconds (and at once when the return page, pages/studio/auth/access.astro, says so),
// the same wait as Add a product (AddProduct.tsx, lib/add-product.ts). Once the copy is ticked, `onVisible` goes on
// as before. GitHub closed with nothing new: the owners decide (nothingNewLine) and Try again. GitHub busy: the busy
// line. Shown to admins only: on the product page right after Add a product, and in Start an exploration.
import { useEffect, useReducer, useRef, useState } from 'react';
import { Button, Spinner } from '@bridge-ds/react';
import { ExternalLink } from 'lucide-react';
import { accessSettingsUrl } from '../../../lib/access-view';
import { ACCESS_TICK_MS, ADD_PRODUCT_WORDS, accessStep, isAccessMessage, nothingNewLine, popupFeatures, waitedTooLong } from '../../../lib/add-product';
import { COPY_WORDS, type CopyAccess } from '../../../lib/design-copy';
import { githubBusy } from '../../../lib/github-busy';
import { BusyNotice } from './BusyNotice';
import { Drawing } from './Drawing';
import '../../../styles/add-product.css';

export interface CopyAccessStepProps {
  access: CopyAccess;
  /** The copy is ticked: Bridge can open it. The caller goes on (waits for the copy, then says it is ready). */
  onVisible: () => void | Promise<void>;
  /** Reads whether the copy is ticked (scripts/design-copy.ts copyVisible); swapped in stories and tests. */
  check?: (access: CopyAccess) => Promise<boolean>;
}

export function CopyAccessStep({ access, onVisible, check }: CopyAccessStepProps) {
  const [step, go] = useReducer(accessStep, { kind: 'list' });
  const [reading, setReading] = useState(false);
  const [done, setDone] = useState(false);
  const popup = useRef<Window | null>(null);
  const busyRead = useRef(false);
  const lastPending = useRef(false);
  const account = access.installation.account?.login ?? access.copy.split('/')[0];

  // One light read. Ticked: GitHub's window closes and the caller goes on. `last`: GitHub is closed, nothing new says so.
  const readAgain = async (last: boolean) => {
    if (done) return;
    if (busyRead.current) {
      if (last) lastPending.current = true;
      return;
    }
    busyRead.current = true;
    setReading(true);
    try {
      const visible = check ? await check(access) : await (await import('../../../scripts/design-copy')).copyVisible(access);
      go({ type: 'read' });
      if (visible) {
        if (popup.current && !popup.current.closed) popup.current.close();
        popup.current = null;
        lastPending.current = false;
        setDone(true);
        go({ type: 'found' });
        await onVisible();
        return;
      }
      if (last) go({ type: 'closed' });
    } catch (err) {
      const b = githubBusy(err);
      if (b) go({ type: 'busy', ...b });
      else if (last) go({ type: 'closed' });
    } finally {
      busyRead.current = false;
      setReading(false);
      if (lastPending.current) {
        lastPending.current = false;
        void readRef.current(true);
      }
    }
  };
  const readRef = useRef(readAgain);
  readRef.current = readAgain;

  // Waiting on GitHub: a read every few seconds while its window is open, one last read once it closes, none after
  // ten minutes.
  useEffect(() => {
    if (step.kind !== 'waiting') return;
    const timer = setInterval(() => {
      const w = popup.current;
      if (!w || w.closed || waitedTooLong(step, Date.now())) {
        clearInterval(timer);
        void readRef.current(true);
        return;
      }
      void readRef.current(false);
    }, ACCESS_TICK_MS);
    return () => clearInterval(timer);
  }, [step]);

  // The return page's message (this site only), and coming back to this window: read at once.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (isAccessMessage(e, location.origin)) void readRef.current(false);
    };
    const onFocus = () => {
      if (document.visibilityState === 'visible' && step.kind !== 'busy') void readRef.current(false);
    };
    window.addEventListener('message', onMessage);
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('message', onMessage);
      window.removeEventListener('focus', onFocus);
    };
  }, [step]);

  const openGitHub = () => {
    const url = accessSettingsUrl(access.installation);
    // A centered window (the page keeps its place); blocked, a new tab. Never noopener: Bridge watches it close.
    const w = window.open(url, 'bridge-github-access', popupFeatures(window)) ?? window.open(url, '_blank');
    if (!w) return;
    popup.current = w;
    go({ type: 'open', at: Date.now() });
  };

  const waiting = step.kind === 'waiting' || done;
  return (
    <div className="addp-wait copy-access" data-copy-access={step.kind}>
      <Drawing name="guide" width={96} className="addp-wait-art" />
      <div className="addp-wait-text">
        <p className="addp-wait-line" role="status">
          {done ? COPY_WORDS.making : waiting ? COPY_WORDS.accessWaiting(access.name) : COPY_WORDS.access(access.name)}
        </p>
        {step.kind === 'busy' && <BusyNotice busy={{ resetsAt: step.resetsAt, source: step.source }} onRetry={() => void readAgain(false)} kept />}
        {waiting && (
          <p className="addp-more">
            <Spinner size="xs" /> <span>{ADD_PRODUCT_WORDS.waitingNote}</span>{' '}
            {!done && (
              <Button variant="link" size="sm" onClick={() => popup.current?.focus()}>
                {ADD_PRODUCT_WORDS.showGitHub}
              </Button>
            )}
          </p>
        )}
        {step.kind === 'nothing-new' && (
          <p className="addp-more">
            <span>{nothingNewLine(account)}</span>{' '}
            <Button variant="link" size="sm" loading={reading} onClick={() => void readAgain(false)}>
              {ADD_PRODUCT_WORDS.tryAgain}
            </Button>
          </p>
        )}
        {!waiting && step.kind !== 'busy' && (
          <span>
            <Button variant="primary" iconEnd={ExternalLink} onClick={openGitHub}>
              {COPY_WORDS.openGitHub}
            </Button>
          </span>
        )}
      </div>
    </div>
  );
}
