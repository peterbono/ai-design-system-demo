// The home's first-visit tour: one DS Popover per step, anchored under what the step points at, "N of M", Skip tour
// and Next (Done on the last). Remembered in this browser once finished. Two tours use it: the demo's, from the DS
// lead's seat (DemoHome.tsx, lib/demo.ts demoTour), and the contributor's, for someone without a review right
// (StudioHome.tsx, lib/home-model.ts contributorTour).
import { useState, type ReactNode } from 'react';
import { Button, Popover, PopoverContent, PopoverTrigger } from '@bridge-ds/react';
import '../../../styles/demo-home.css';

/** One step of a tour: a DS Popover anchored where the step points. */
export function TourStep({ n, total, words, onNext, onFinish, onClose }: { n: number; total: number; words: { title: string; text: string }; onNext: () => void; onFinish: () => void; onClose: () => void }) {
  const last = n === total;
  return (
    <Popover open onOpenChange={(o) => !o && onClose()}>
      <PopoverTrigger nativeButton={false} render={<span className="dh-tour-anchor" aria-hidden="true" tabIndex={-1} />} />
      <PopoverContent side="bottom" align="start" className="dh-tour" title={words.title} description={words.text}>
        <div className="dh-tour-foot">
          <span className="t-ui t-muted">
            {n} of {total}
          </span>
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
