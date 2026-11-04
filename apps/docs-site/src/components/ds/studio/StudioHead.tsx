// The Studio page header for React islands, the twin of components/StudioHeader.astro (same markup and classes, the
// st-head styles in styles/studio-app.css): the title with the primary action on its line, one summary sentence
// and extra lines. `titleAfter`: a control that acts on the title, right after it on
// its line (the product page's Rename). `more`: the "..." More actions button for what the page shows (the product
// page's menu), last on the title line at every width: on a phone the actions move under the summary, the "..." stays
// by the title it acts on. No drawing: the primary action owns the end of the title line.
import type { ReactNode } from 'react';
import type { SectionSceneName } from './QuietScene';

export function StudioHead({
  title,
  titleAfter,
  summary,
  scene,
  actions,
  more,
  children,
}: {
  title: ReactNode;
  titleAfter?: ReactNode;
  summary?: ReactNode;
  scene?: SectionSceneName;
  actions?: ReactNode;
  more?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="st-head" data-scene={scene}>
      <div className="st-head-main">
        <div className="st-title-row">
          {titleAfter ? (
            // The title and the control that acts on it stay on one line, on a phone too (where the row lets go).
            <div className="st-title-line">
              <h1 className="st-title">{title}</h1>
              {titleAfter}
            </div>
          ) : (
            <h1 className="st-title">{title}</h1>
          )}
          <div className="st-head-actions" data-st-actions="">
            {actions}
          </div>
          {more && (
            <div className="st-head-more" data-st-more="">
              {more}
            </div>
          )}
        </div>
        <p className="st-sub" data-st-summary="" aria-live="polite">
          {summary}
        </p>
        {children}
      </div>
    </header>
  );
}

export default StudioHead;
