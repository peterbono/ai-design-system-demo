// "Figma is ahead: 2 changes being built (Malik)." on a component's Library page, by the Storybook hero, while build
// requests for that component are open (developers build what was sent from Figma). It disappears once they ship.
// Nothing shows when none is open or the build requests could not be read. `load` reads them: scripts/building-data.ts
// (loadBuildData on Bridge's own Library, buildViewsFor on a team's Library).
import { useEffect, useState } from 'react';
import { Icon, Link } from '@bridge-ds/react';
import { Wrench } from 'lucide-react';
import { figmaAheadLine, type BuildRequestView } from '@bridge-ds/core';

export interface FigmaAheadProps {
  component: string;
  /** Being built in Studio, for this library's team. */
  href: string;
  load: () => Promise<{ views: BuildRequestView[]; nameOf: (login: string) => string }>;
}

export function FigmaAhead({ component, href, load }: FigmaAheadProps) {
  const [line, setLine] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    load()
      .then((d) => live && setLine(figmaAheadLine(d.views, component, d.nameOf)?.sentence ?? null))
      .catch(() => {});
    return () => {
      live = false;
    };
    // Once per page and component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [component]);
  if (!line) return null;
  return (
    <p className="t-ui cp-ahead" role="status">
      <Icon icon={Wrench} size="sm" />
      <span>{line}</span>
      <Link href={href}>See what is being built</Link>
    </p>
  );
}
