// The landing's two folds, as DS Accordions in one hydrated island (client:visible): the four questions (one open at
// a time), and "Same journey in your terminal" with the real MCP tools Claude calls. Words: lib/landing.ts.
import { Accordion, AccordionItem, CodeBlock, Link } from '@bridge-ds/react';
import { FAQ, terminalText } from '../../lib/landing';

export default function LandingFaq({ part }: { part: 'faq' | 'terminal' }) {
  if (part === 'terminal') {
    return (
      <Accordion headingLevel={3} className="lp-terminal">
        <AccordionItem value="terminal" title="Same journey in your terminal">
          <div className="lp-terminal-body">
            <CodeBlock code={terminalText()} label="A session with Claude AI" wrap />
            <Link href="/agents/">MCP and CLI docs</Link>
          </div>
        </AccordionItem>
      </Accordion>
    );
  }
  return (
    <Accordion headingLevel={3} className="lp-faq">
      {FAQ.map((f) => (
        <AccordionItem key={f.id} value={f.id} title={f.question}>
          <p className="lp-faq-answer">{f.answer}</p>
        </AccordionItem>
      ))}
    </Accordion>
  );
}
