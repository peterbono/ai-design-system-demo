// "Questions teams ask." on the homepage: the DS Accordion, one answer open at a time, hydrated when it scrolls into
// view (client:visible). Words: lib/homepage.ts FAQ.
import { Accordion, AccordionItem } from '@bridge-ds/react';
import { FAQ } from '../../lib/homepage';

export default function HpFaq() {
  return (
    <Accordion headingLevel={3} className="hp-faq-list">
      {FAQ.map((f) => (
        <AccordionItem key={f.id} value={f.id} title={f.question}>
          <p className="hp-faq-answer">{f.answer}</p>
        </AccordionItem>
      ))}
    </Accordion>
  );
}
