// The Studio home on the demo for a visitor who cannot change it (lib/demo.ts exploresDemo), boards D1 and D1b: the
// signed-in home itself (StudioHome.tsx), from the DS lead's seat, with the demo's real activity read-only.
//   - The Harbor zone as the lead has it: "Good morning, Dana." by the Field Guide drawing, "8 changes need your
//     review. Ann and Claude AI are waiting on Dana, who leads this design system.", three Needs you rows each with
//     its Review button, and beyond them the grouped row with its one primary "Review all (8)" (the review queue, which
//     a visitor browses read-only).
//   - The library health line, then "Explorations and branches": the team's work as the home's cards.
//   - A three-step tour on the first visit (TourStep), anchored under the rows, the grouped row and the branches.
// The "Demo workspace" banner over every Studio page is DemoBanner.tsx. Data: scripts/demo-home.ts.
import { createRoot, type Root } from 'react-dom/client';
import { useState, type ReactNode } from 'react';
import { Button, Popover, PopoverContent, PopoverTrigger } from '@bridge-ds/react';
import { StudioHome, type HealthLine, type HomeComponent, type StudioHomeProps } from './StudioHome';
import { DEMO_TOUR, DEMO_WORDS, tourSteps, type TourAt } from '../../../lib/demo';
import { greeting, shortName, splitNeeds, type BranchCard, type NeedRow, type Person } from '../../../lib/home-model';
import '../../../styles/demo-home.css';

export interface DemoHomeProps {
  loading: boolean;
  needs: NeedRow[];
  branches: BranchCard[];
  /** The DS lead whose seat the visitor takes. */
  lead: Person | null;
  health: HealthLine | null;
  /** GitHub could not be read. */
  failed: string | null;
  now: number;
  components: HomeComponent[];
  startHrefs: StudioHomeProps['startHrefs'];
}

const TOUR_KEY = 'bridge.demo.tour';
/** One row of cards on a wide screen (board D1); "See all" opens Branches. */
export const BRANCH_CARDS = 4;

function tourDone(): boolean {
  try {
    return localStorage.getItem(TOUR_KEY) === 'done';
  } catch {
    return false;
  }
}

/** One step of the tour: a DS Popover anchored where the step points. */
function TourStep({ n, total, at, onNext, onFinish, onClose }: { n: number; total: number; at: TourAt; onNext: () => void; onFinish: () => void; onClose: () => void }) {
  const words = DEMO_TOUR[at];
  const last = n === total;
  return (
    <Popover open onOpenChange={(o) => !o && onClose()}>
      <PopoverTrigger render={<span className="dh-tour-anchor" aria-hidden="true" tabIndex={-1} />} />
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

export function DemoHome(p: DemoHomeProps) {
  const [step, setStep] = useState<number | null>(() => (tourDone() ? null : 0));
  const { more } = splitNeeds(p.needs);
  const steps = tourSteps({ rows: p.needs.length > 0, more: Boolean(more), branches: p.branches.length > 0 });
  const finish = () => {
    try {
      localStorage.setItem(TOUR_KEY, 'done');
    } catch {
      /* private mode: the tour comes back on the next visit */
    }
    setStep(null);
  };
  const tour = (at: TourAt): ReactNode =>
    !p.loading && step !== null && steps[step] === at ? <TourStep key={at} n={step + 1} total={steps.length} at={at} onNext={() => setStep(step + 1)} onFinish={finish} onClose={() => setStep(null)} /> : null;
  const leadName = p.lead ? (shortName(p.lead.name) ?? p.lead.name) : null;
  return (
    <StudioHome
      state={p.loading && !p.needs.length ? 'loading' : 'busy'}
      greeting={greeting(new Date(p.now).getHours(), leadName)}
      needs={p.needs}
      branches={p.branches}
      health={p.health}
      now={p.now}
      components={p.components}
      signedOut={{ line: '', button: '', signIn: true }}
      failed={p.failed}
      startHrefs={p.startHrefs}
      demo={{ lead: p.lead && { ...p.lead, name: leadName ?? p.lead.name }, branchesTitle: DEMO_WORDS.branches, branchesMax: BRANCH_CARDS }}
      tour={tour}
    />
  );
}

/** Mounts the demo home into `el` once; later calls repaint it. */
export function paintDemoHome(el: HTMLElement, props: DemoHomeProps, root?: Root | null): Root {
  const r = root ?? createRoot(el);
  r.render(<DemoHome {...props} />);
  return r;
}
