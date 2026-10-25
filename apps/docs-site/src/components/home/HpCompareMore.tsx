// "Compare every feature" under the short table (homepage): the DS Accordion, closed at first, holding every feature by
// group. Its trigger reads "Hide the full comparison" while open. Hydrated by HpCompare.astro with client:visible.
import { useState } from 'react';
import { Accordion, AccordionItem } from '@bridge-ds/react';
import HpCompareTable from './HpCompareTable';
import { FULL_CAPTION, FULL_FIRST_HEAD, GROUPS, MORE_CLOSED, MORE_OPEN } from '../../lib/compare';

const ITEM = 'every-feature';

export default function HpCompareMore() {
  const [open, setOpen] = useState<string[]>([]);
  const isOpen = open.includes(ITEM);
  return (
    <Accordion appearance="flush" headingLevel={3} value={open} onValueChange={setOpen} className="hp-cmp-more">
      <AccordionItem value={ITEM} title={isOpen ? MORE_OPEN : MORE_CLOSED}>
        <div className="hp-cmp-full">
          <HpCompareTable label={FULL_CAPTION} firstHead={FULL_FIRST_HEAD} groups={GROUPS} />
        </div>
      </AccordionItem>
    </Accordion>
  );
}
