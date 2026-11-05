// The "In Figma" line on Bridge's own Library component page (pages/components/[slug].astro), an island in the
// ComponentView `figma` slot. This page never starts the Studio's GitHub session (scripts/shell.ts initStudio skips the
// Library), so its role source is the maintainer check (scripts/maintainer.ts): a GitHub account that writes to the
// repository (admin, maintain or push) is a lead here and reads "Not linked to Figma yet" with the next step.
import { useEffect, useState } from 'react';
import { FigmaLink, type FigmaLinkProps } from './ds/library/FigmaLink';
import { isMaintainer, onMaintainer } from '../scripts/maintainer';

export default function FigmaLinkSite(props: Omit<FigmaLinkProps, 'canFix'>) {
  // The head script painted the last check before this island mounts: no jump on load.
  const [lead, setLead] = useState(isMaintainer);
  useEffect(() => {
    setLead(isMaintainer());
    return onMaintainer(setLead);
  }, []);
  return <FigmaLink {...props} canFix={lead} />;
}
