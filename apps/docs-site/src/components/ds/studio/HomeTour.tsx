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

/** Where a step shows: floating by what it points at, or in the page flow on a narrow screen (it never covers a card). */
export const tourPlacement = (narrow: boolean): 'popover' | 'inline' => (narrow ? 'inline' : 'popover');

function useNarrow(): boolean {
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
  if (tourPlacement(narrow) === 'inline') return <InlineStep n={n} total={total} words={words} onNext={onNext} onFinish={onFinish} />;
  return (
    <Popover open onOpenChange={(o) => !o && onClose()}>
      <PopoverTrigger nativeButton={false} render={<span className="dh-tour-anchor" aria-hidden="true" tabIndex={-1} />} />
      <PopoverContent side="bottom" align="start" className="dh-tour" title={words.title} description={words.text}>
        <TourFoot n={n} total={total} onNext={onNext} onFinish={onFinish} />
      </PopoverContent>
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
