// The Studio home on the demo for a visitor who cannot change it (lib/demo.ts exploresDemo), boards D1 and D1b: the
// signed-in home itself (StudioHome.tsx), from the DS lead's seat, with the demo's real activity read-only.
//   - The Harbor zone as the lead has it: "Good morning, Dana." by the Field Guide drawing, "8 changes need your
//     review. Ann and Claude AI are waiting on you.", three Needs you rows each with
//     its Review button, and beyond them the grouped row with its one primary "Review all" (the Review page, which
//     a visitor browses read-only).
//   - The library health line, then "Explorations": "+ Start an exploration" first, as on the signed-in home (its
//     click opens the demo's sign-in dialog, scripts/demo-gate.ts), then the team's explorations as the home's cards,
//     each its explored screen. Library changes are not cards: they wait in the lead's queue and live on Changes.
//   - A three-step tour on the first visit (HomeTour.tsx), anchored under the rows, the grouped row and the explorations.
// The demo banner over every Studio page is DemoBanner.tsx. Data: scripts/demo-home.ts.
import { createRoot, type Root } from 'react-dom/client';
import { StudioHome, type HealthLine, type HomeComponent, type StudioHomeProps } from './StudioHome';
import { DEMO_WORDS, demoTour, tourSteps, type TourAt } from '../../../lib/demo';
import { useTour } from './HomeTour';
import { greeting, shortName, splitNeeds, type NeedRow, type Person } from '../../../lib/home-model';
import type { ExplorationCard } from '../../../lib/home-explorations';
import '../../../styles/demo-home.css';

export interface DemoHomeProps {
  loading: boolean;
  needs: NeedRow[];
  /** The team's explorations (scripts/demo-home.ts). */
  explorations: ExplorationCard[];
  /** The persona whose seat the visitor takes (bridge.config.json "demo"), null for none. */
  lead: Person | null;
  /** The persona's role ("DS lead"). */
  role: string | null;
  health: HealthLine | null;
  /** The calm Being built line (StudioHome `building`). */
  building?: boolean;
  /** GitHub could not be read. */
  failed: string | null;
  now: number;
  components: HomeComponent[];
  startHrefs: StudioHomeProps['startHrefs'];
}

const TOUR_KEY = 'bridge.demo.tour';

export function DemoHome(p: DemoHomeProps) {
  const { more } = splitNeeds(p.needs);
  const steps = tourSteps({ rows: p.needs.length > 0, more: Boolean(more), branches: p.explorations.length > 0 });
  const tour = useTour<TourAt>(TOUR_KEY, steps, (at) => demoTour(at, p.role), !p.loading);
  const leadName = p.lead ? (shortName(p.lead.name) ?? p.lead.name) : null;
  // "Good morning, Dana." with a persona; "Good morning." without one.
  return (
    <StudioHome
      state={p.loading && !p.needs.length ? 'loading' : 'busy'}
      greeting={greeting(new Date(p.now).getHours(), leadName)}
      needs={p.needs}
      branches={[]}
      explorations={p.explorations}
      health={p.health}
      building={p.building}
      now={p.now}
      components={p.components}
      signedOut={{ line: '', button: '', signIn: true }}
      failed={p.failed}
      startHrefs={p.startHrefs}
      demo={{ lead: p.lead && { ...p.lead, name: leadName ?? p.lead.name }, explorationsTitle: DEMO_WORDS.explorations }}
      tour={(at) => (at === 'start' ? null : tour(at))}
    />
  );
}

/** Mounts the demo home into `el` once; later calls repaint it. */
export function paintDemoHome(el: HTMLElement, props: DemoHomeProps, root?: Root | null): Root {
  const r = root ?? createRoot(el);
  r.render(<DemoHome {...props} />);
  return r;
}
