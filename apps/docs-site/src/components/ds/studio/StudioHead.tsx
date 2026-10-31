// The Studio page header for React islands, the twin of components/StudioHeader.astro (same markup and classes, the
// st-head styles in styles/studio-app.css): the title with the primary action on its line, one summary sentence,
// an optional "How it works" fold and extra lines. `titleAfter`: a control that acts on the title, right after it on
// its line (the product page's Rename). No drawing: the primary action owns the end of the title line.
import type { ReactNode } from 'react';
import type { SectionSceneName } from './QuietScene';

export function StudioHead({ title, titleAfter, summary, scene, actions, how, children }: { title: ReactNode; titleAfter?: ReactNode; summary?: ReactNode; scene?: SectionSceneName; actions?: ReactNode; how?: ReactNode; children?: ReactNode }) {
  return (
    <header className="st-head" data-scene={scene}>
      <div className="st-head-main">
        <div className="st-title-row">
          <h1 className="st-title">{title}</h1>
          {titleAfter}
          <div className="st-head-actions" data-st-actions="">
            {actions}
          </div>
        </div>
        <p className="st-sub" data-st-summary="" aria-live="polite">
          {summary}
        </p>
        {how && (
          <details className="st-how">
            <summary>How it works</summary>
            <div className="st-how-body">{how}</div>
          </details>
        )}
        {children}
      </div>
    </header>
  );
}

export default StudioHead;
