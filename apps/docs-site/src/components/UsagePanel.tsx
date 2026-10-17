// The Usage tab of a Library component page: when to use, do and don't, accessibility, content guidelines. One
// renderer for the static Library page (examples rendered at build time with every Lucide icon) and the live preview
// of the docs editor (a hydrated island with a small icon set), so the editor shows the real page.
import type { ComponentType } from 'react';
import { Badge } from '@bridge-ds/react';
import { Check, X } from 'lucide-react';
import { iconSvg } from '../brand/icons';
import type { ComponentDocs, ExampleNode } from '../lib/components';

/** Same markup as components/Icon.astro. */
function SiteIcon({ name, size }: { name: 'check' | 'x'; size: number }) {
  return <span className="icon" dangerouslySetInnerHTML={{ __html: iconSvg(name, size) }} />;
}

export interface UsagePanelProps {
  docs: Pick<ComponentDocs, 'whenToUse' | 'whenNotToUse' | 'dos' | 'donts' | 'accessibility' | 'contentGuidelines'>;
  /** Renders a docs example with the real components. */
  Example: ComponentType<{ node: ExampleNode }>;
  /** Heading ids are unique per page; the editor preview prefixes them. */
  idPrefix?: string;
}

export default function UsagePanel({ docs: d, Example, idPrefix = '' }: UsagePanelProps) {
  const id = (s: string) => `${idPrefix}${s}`;
  return (
    <>
      <section aria-labelledby={id('usage')}>
        <h2 id={id('usage')}>When to use</h2>
        <div className="usage-grid">
          <div className="usage-col is-use">
            <h3>
              <SiteIcon name="check" size={18} /> Use it for
            </h3>
            <ul>
              {d.whenToUse.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          </div>
          <div className="usage-col is-avoid">
            <h3>
              <SiteIcon name="x" size={18} /> Not for
            </h3>
            <ul>
              {d.whenNotToUse.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section aria-labelledby={id('do-dont')}>
        <h2 id={id('do-dont')}>Do and don't</h2>
        <p className="muted">Every example is rendered with the real component, so it always matches what ships.</p>
        <div className="guidance">
          {d.dos.map((g, i) => (
            <figure className="verdict do" key={`do-${i}`}>
              {g.example && (
                <div className="verdict-stage" data-theme="light">
                  <Example node={g.example} />
                </div>
              )}
              <figcaption className="verdict-body">
                <Badge tone="success" icon={Check}>
                  Do
                </Badge>
                <h4>{g.title}</h4>
                <p>{g.text}</p>
              </figcaption>
            </figure>
          ))}
          {d.donts.map((g, i) => (
            <figure className="verdict dont" key={`dont-${i}`}>
              {g.example && (
                <div className="verdict-stage" data-theme="light" {...({ inert: '' } as object)}>
                  <Example node={g.example} />
                </div>
              )}
              <figcaption className="verdict-body">
                <Badge tone="danger" icon={X}>
                  Don't
                </Badge>
                <h4>{g.title}</h4>
                <p>{g.text}</p>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section aria-labelledby={id('accessibility')}>
        <h2 id={id('accessibility')}>Accessibility</h2>
        <ul className="a11y-list">
          {d.accessibility.map((x, i) => (
            <li key={i}>
              <SiteIcon name="check" size={16} />
              <span>{x}</span>
            </li>
          ))}
        </ul>
      </section>

      {(d.contentGuidelines?.length ?? 0) > 0 && (
        <section aria-labelledby={id('content')}>
          <h2 id={id('content')}>Content guidelines</h2>
          <ul className="cp-content-list">
            {d.contentGuidelines!.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
