// "For developers" under a section of a docs page (pages/docs/security.astro): the DS Accordion with one item,
// closed by default, so the plain-words answer comes first and the file-level detail stays one click away.
// The Astro page passes the detail as children (static HTML) and hydrates this with client:visible.
import type { ReactNode } from 'react';
import { Accordion, AccordionItem } from '@bridge-ds/react';

export interface DevDetailProps {
  /** Unique per page: the item value. */
  id: string;
  /** The trigger text. */
  title?: string;
  children?: ReactNode;
}

export default function DevDetail({ id, title = 'For developers: where this is in the code', children }: DevDetailProps) {
  return (
    <Accordion headingLevel={3} className="dc-dev">
      <AccordionItem value={id} title={title}>
        {children}
      </AccordionItem>
    </Accordion>
  );
}
