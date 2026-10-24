// The "Figma is ahead" line on Bridge's own Library component page (pages/components/[slug].astro), an island in the
// ComponentView `ahead` slot: Bridge's build requests read in the browser (scripts/building-data.ts).
import { FigmaAhead } from './ds/library/FigmaAhead';
import { loadBuildData } from '../scripts/building-data';
import { studioHref } from '../lib/team-path';

export default function FigmaAheadSite({ component }: { component: string }) {
  return <FigmaAhead component={component} href={studioHref('building/')} load={() => loadBuildData()} />;
}
