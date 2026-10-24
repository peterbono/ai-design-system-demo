// The calm Being built line of the Studio home (StudioHome `building`): "Build requests: 3 being built, 1 waiting to be
// picked up." (from the Figma plugin or from Components, Change this component)
// with a link to the page, under the Harbor zone. Never a Needs you row: a build request waits on developers, not on
// the viewer. Nothing shows while nothing is open, or when the build requests could not be read. Data:
// scripts/building-data.ts (the sample team's sample ones on the demo).
import { useEffect, useState } from 'react';
import { Icon, Link } from '@bridge-ds/react';
import { Wrench } from 'lucide-react';
import { buildSummaryLine } from '@bridge-ds/core';
import { studioHref } from '../../../lib/team-path';
import { loadBuildData } from '../../../scripts/building-data';
import '../../../styles/building.css';

export function BuildLine() {
  const [line, setLine] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    loadBuildData()
      .then((d) => live && setLine(buildSummaryLine(d.views)))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  if (!line) return null;
  return (
    <p className="t-ui t-muted sh-health bb-home">
      <Icon icon={Wrench} size="sm" />
      <span>Build requests: {line.charAt(0).toLowerCase() + line.slice(1)}</span>
      <Link href={studioHref('building/')}>See what is being built</Link>
    </p>
  );
}
