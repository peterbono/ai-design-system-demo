// The home's first-visit tour: one DS Popover per step, anchored under what the step points at, "N of M", Skip tour
// and Next (Done on the last). On a narrow screen (a phone) a floating popover has nowhere to go but over the cards it
// talks about, so the step is a DS Card in the page flow instead, where the anchor sits: it moves the cards down and
// covers none of them (tourPlacement). Remembered in this browser once finished. Two tours use it: the demo's, from the DS
// lead's seat (DemoHome.tsx, lib/demo.ts demoTour), and the contributor's, for someone without a review right
// (StudioHome.tsx, lib/home-model.ts contributorTour).
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button, Card, CardBody, Popover, PopoverContent, PopoverTrigger } from '@bridge-ds/react';
import '../../../styles/demo-home.css';

/** Phone widths, the home's own breakpoint (studio-home.css). */
export const NARROW_TOUR = '(max-width: 640px)';

/** The room a floating step needs under its anchor, in CSS pixels: a title, three lines and the buttons. */
const TOUR_ROOM = 240;
/** Waits for the popover to open and take focus before measuring, in ms. */
const TOUR_SETTLE = 120;

/** Where a step shows: floating by what it points at, or in the page flow on a narrow screen (it never covers a card). */
export const tourPlacement = (narrow: boolean): 'popover' | 'inline' => (narrow ? 'inline' : 'popover');

/** True on a narrow screen (NARROW_TOUR): where a step sits in the page flow, so the page can pick its anchor. */
export function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(NARROW_TOUR).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const m = window.matchMedia(NARROW_TOUR);
    const on = () => setNarrow(m.matches);
    on();
    m.addEventListener?.('change', on);
    return () => m.removeEventListener?.('change', on);
  }, []);
  return narrow;
}

function TourFoot({ n, total, onNext, onFinish }: { n: number; total: number; onNext: () => void; onFinish: () => void }) {
  const last = n === total;
  return (
    <div className="dh-tour-foot">
      {/* A tour of one step has no "1 of 1". */}
      <span className="t-ui t-muted">{total > 1 ? `${n} of ${total}` : ''}</span>
      <span className="dh-tour-actions">
        {!last && (
          <Button variant="ghost" size="sm" onClick={onFinish}>
            Skip tour
          </Button>
        )}
        <Button variant="primary" size="sm" onClick={last ? onFinish : onNext}>
          {last ? 'Done' : 'Next'}
        </Button>
      </span>
    </div>
  );
}

/** A step in the page flow (narrow screens): the same words and buttons, brought into view from the second step on. */
function InlineStep({ n, total, words, onNext, onFinish }: { n: number; total: number; words: { title: string; text: string }; onNext: () => void; onFinish: () => void }) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // The first step shows where the page opens; a later one may sit below the fold (after the cards).
    if (n > 1) ref.current?.scrollIntoView?.({ block: 'nearest' });
  }, [n]);
  return (
    <Card ref={ref} role="group" aria-labelledby={`${id}-t`} aria-describedby={`${id}-d`} className="dh-tour-inline" data-tour-inline="">
      <CardBody className="dh-tour-inline-body">
        <p id={`${id}-t`} className="dh-tour-title">
          {words.title}
        </p>
        <p id={`${id}-d`} className="t-ui t-muted dh-tour-text">
          {words.text}
        </p>
        <TourFoot n={n} total={total} onNext={onNext} onFinish={onFinish} />
      </CardBody>
    </Card>
  );
}

/** One step of a tour: a DS Popover anchored where the step points, or a card in the flow on a narrow screen. */
export function TourStep({ n, total, words, onNext, onFinish, onClose }: { n: number; total: number; words: { title: string; text: string }; onNext: () => void; onFinish: () => void; onClose: () => void }) {
  const narrow = useNarrow();
  const anchor = useId();
  const inline = tourPlacement(narrow) === 'inline';
  // Room under the anchor when the page ends right after it (the step under the last cards): without it the page
  // cannot scroll far enough and the step flips above, over the cards.
  const [room, setRoom] = useState(false);
  useEffect(() => {
    if (inline) return;
    // The step floats under what it points at: when that sits low on the screen, bring it up first so the step has
    // room below it, instead of flipping above and covering what it talks about. Measured once the popover opened and
    // took focus (which may scroll on its own).
    const t = window.setTimeout(() => {
      const bottom = document.querySelector(`[data-tour-anchor="${anchor}"]`)?.getBoundingClientRect().bottom;
      const short = bottom === undefined ? 0 : bottom + TOUR_ROOM - window.innerHeight;
      if (short <= 0) return;
      const left = document.documentElement.scrollHeight - window.innerHeight - window.scrollY;
      if (short > left && !room) setRoom(true);
      else window.scrollBy({ top: short });
    }, TOUR_SETTLE);
    return () => window.clearTimeout(t);
  }, [inline, anchor, n, room]);
  if (inline) return <InlineStep n={n} total={total} words={words} onNext={onNext} onFinish={onFinish} />;
  return (
    <Popover open onOpenChange={(o) => !o && onClose()}>
      <PopoverTrigger nativeButton={false} render={<span className="dh-tour-anchor" data-tour-anchor={anchor} aria-hidden="true" tabIndex={-1} />} />
      <PopoverContent side="bottom" align="start" className="dh-tour" title={words.title} description={words.text}>
        <TourFoot n={n} total={total} onNext={onNext} onFinish={onFinish} />
      </PopoverContent>
      {room && <span className="dh-tour-room" aria-hidden="true" />}
    </Popover>
  );
}

function done(key: string): boolean {
  try {
    return localStorage.getItem(key) === 'done';
  } catch {
    return false;
  }
}

/**
 * A tour over `steps` (in order), stored under `key`: returns what to render at each anchor. `ready` false (still
 * loading) keeps it hidden without losing the step.
 */
export function useTour<A extends string>(key: string, steps: A[], words: (at: A) => { title: string; text: string }, ready: boolean): (at: A) => ReactNode {
  const [step, setStep] = useState<number | null>(() => (done(key) ? null : 0));
  const finish = () => {
    try {
      localStorage.setItem(key, 'done');
    } catch {
      /* private mode: the tour comes back on the next visit */
    }
    setStep(null);
  };
  return (at: A) =>
    ready && step !== null && steps[step] === at ? <TourStep key={at} n={step + 1} total={steps.length} words={words(at)} onNext={() => setStep(step + 1)} onFinish={finish} onClose={() => setStep(null)} /> : null;
}
