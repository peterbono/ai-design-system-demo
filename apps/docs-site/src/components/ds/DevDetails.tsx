// The one "For developers" disclosure at the bottom of a Library page, as a DS Accordion (hydrated, client:visible).
// Its content comes from the Astro slot: file paths, links to GitHub and npm, commands.
import type { ReactNode } from 'react';
import { Accordion, AccordionItem } from '@bridge-ds/react';

export interface DevDetailsProps {
  children?: ReactNode;
}

export default function DevDetails({ children }: DevDetailsProps) {
  return (
    <Accordion headingLevel={2} className="dev-details">
      <AccordionItem value="dev" title="For developers">
        {children}
      </AccordionItem>
    </Accordion>
  );
}
