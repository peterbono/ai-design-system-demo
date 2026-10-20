// Station 3 of the landing: the review in the product, as real Bridge components. Before and After swap the
// Overdue cell from plain text to the new Badge tone; Light and Dark repaint the same screen with the real dark tokens
// (a data-theme scope), where the contrast check passes too. A hydrated island (client:visible): the one place on the
// landing where a visitor flips the change. On first view, After shows itself once (never under reduced motion, never
// after the visitor picked).
import { useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { Badge, SegmentedControl } from '@bridge-ds/react';

// Placeholder bars stand for the invoice text: the change is the status cell, so nothing else pretends to be data.
const ROWS = [
  { id: 'a', state: 'paid' },
  { id: 'b', state: 'overdue' },
  { id: 'c', state: 'draft' },
  { id: 'd', state: 'paid' },
] as const;

export default function LandingReview() {
  const [view, setView] = useState<'before' | 'after'>('before');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const touched = useRef(false);
  const root = useRef<HTMLDivElement | null>(null);

  // Start on the page theme, and follow it until the visitor picks one here.
  useEffect(() => {
    const html = document.documentElement;
    const sync = () => {
      if (!touched.current) setTheme(html.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
    };
    sync();
    const mo = new MutationObserver(sync);
    mo.observe(html, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, []);

  // Show After once when the card comes into view, unless motion is reduced or the visitor already chose.
  useEffect(() => {
    const el = root.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let timer = 0;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        timer = window.setTimeout(() => {
          if (!touched.current) setView('after');
        }, 900);
      },
      { threshold: 0.6 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      window.clearTimeout(timer);
    };
  }, []);

  const after = view === 'after';
  return (
    <div className="lp-review" ref={root}>
      <div className="lp-review-bar">
        <SegmentedControl
          size="sm"
          label="Show the screen before or after the change"
          value={view}
          onValueChange={(v) => {
            touched.current = true;
            setView(v === 'after' ? 'after' : 'before');
          }}
          items={[
            { value: 'before', label: 'Before' },
            { value: 'after', label: 'After' },
          ]}
        />
        <SegmentedControl
          size="sm"
          label="Theme of the screen"
          value={theme}
          onValueChange={(v) => {
            touched.current = true;
            setTheme(v === 'dark' ? 'dark' : 'light');
          }}
          items={[
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
      </div>
      <div className="lp-review-screen" data-theme={theme} data-brand="bridge" data-density="comfortable" data-view={view}>
        <p className="lp-review-title">
          <span>Admin demo</span>
          <span className="lp-muted">Invoices</span>
        </p>
        <ul className="lp-review-rows" aria-live="polite">
          {ROWS.map((r) => (
            <li key={r.id} className="lp-review-row">
              <span className="lp-bar" aria-hidden="true" />
              <span className="lp-review-state">
                {r.state === 'paid' && <Badge tone="success" size="sm">Paid</Badge>}
                {r.state === 'draft' && <Badge size="sm">Draft</Badge>}
                {r.state === 'overdue' &&
                  (after ? (
                    <Badge tone="danger" size="sm" className="lp-new">
                      Overdue
                    </Badge>
                  ) : (
                    <span className="lp-muted">Overdue</span>
                  ))}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <p className="lp-review-foot">
        {after ? (
          <Badge tone="success" icon={Check}>
            Contrast passes in {theme}
          </Badge>
        ) : (
          <span className="lp-muted">Today: Overdue is plain grey text.</span>
        )}
      </p>
    </div>
  );
}
