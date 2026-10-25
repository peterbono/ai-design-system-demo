// How far Bridge has gone reading a design system (lib/load-progress.ts words it). A calm stepper: the steps done so
// far with a check, the current one with its bar under it. The bar is the DS Progress: determinate from real file
// counts, indeterminate when the total is unknown, its value said in words to screen readers. The step itself is
// announced once per step in a polite live region (never per file).
// Presentational only: TeamState.tsx TeamLoadProgress feeds it a team page's load, StorybookComponents the quick start.
import { CircleCheck, CircleDot } from 'lucide-react';
import { Icon, Progress, VisuallyHidden } from '@bridge-ds/react';
import '../../../styles/load-progress.css';
import type { LoadProgressView } from '../../../lib/load-progress';

export function LoadProgress({ view, label }: { view: LoadProgressView; label: string }) {
  return (
    <section className="lp" aria-label={label} aria-busy={!view.done} data-done={view.done ? '' : undefined}>
      <VisuallyHidden aria-live="polite">{view.status}</VisuallyHidden>
      <ol className="lp-steps">
        {view.steps.map((s) => (
          <li key={s.label} className="lp-step" data-state={s.state} aria-current={s.state === 'current' ? 'step' : undefined}>
            <Icon icon={s.state === 'done' || view.done ? CircleCheck : CircleDot} size="sm" className="lp-icon" />
            <div className="lp-body">
              <span className="lp-label">{s.label}</span>
              {s.state === 'current' && (
                <>
                  <Progress
                    className="lp-bar"
                    value={view.value === null ? null : view.value}
                    max={view.max}
                    size="sm"
                    tone={view.done ? 'success' : 'signal'}
                    aria-label={view.status}
                    getAriaValueText={() => view.valueText ?? view.status}
                  />
                  {view.detail && <span className="lp-detail">{view.detail}</span>}
                </>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
