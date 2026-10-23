// The Library home, for any repo model: one sentence on what the Library holds and the one way in (Browse
// components), the three places as cards with their counts, then what changed lately when the source knows its
// release notes. Bridge's own home renders it at build time (pages/library/index.astro), a team's Library in the
// browser (LibraryTeamPage.tsx).
import { Badge, Link } from '@bridge-ds/react';
import ButtonLink from '../../ButtonLink';
import { Drawing } from '../../studio/Drawing';
import type { IllustrationName } from '../../../../brand/illustrations';
import { libraryHome } from '../../../../lib/library/home';
import { loadComponents } from '../../../../lib/library/components';
import { tokenRows } from '../../../../lib/library/tokens';
import { pageHref, systemName, type LibraryData } from '../library-data';

export default function LandingView({ data }: { data: LibraryData }) {
  const { model, extras } = data;
  // Counts on the topic cards come from the same data as the pages they open.
  const semantic = tokenRows(model).all.filter((t) => t.tier === 'semantic').length;
  const componentCount = model.components ? loadComponents(model).length : 0;
  const topics: { art: IllustrationName; title: string; text: string; route: string }[] = [
    { art: 'foundations', title: 'Foundations', text: 'Color, type, spacing and the accessibility rules underneath.', route: 'foundations/color/' },
    { art: 'tokens', title: 'All tokens', text: `All ${semantic} semantic tokens with their light and dark values, ready to copy.`, route: 'tokens/' },
    { art: 'components', title: 'Components', text: `${componentCount} React components with examples, props and guidance.`, route: 'components/' },
  ];
  const changes = extras.changes;
  return (
    <>
      <section className="zone hm-hero" aria-labelledby="hero-title">
        <div className="hm-hero-copy">
          {data.team && <p className="ltm-eyebrow">Design system library</p>}
          <h1 id="hero-title" className="t-display">
            {data.team ? `The ${systemName(data)} design system` : 'Your design system, one source of truth.'}
          </h1>
          <p className="t-body">
            {data.team ? (
              `${libraryHome(model).lead} Tokens, components and how to use them, published from the repository.`
            ) : (
              <>
                Bridge keeps your tokens, components and docs in one repository. This Library always shows the latest release, <span className="mono">{extras.version}</span>.
              </>
            )}
          </p>
          <ButtonLink variant="primary" href={pageHref(data, 'components/')}>
            Browse components
          </ButtonLink>
        </div>
        <div className="hm-hero-art">
          <Drawing name="hero" width={400} label="Two people finishing a plank bridge" />
        </div>
      </section>

      <section className="hm-topics" aria-label="In the Library">
        {topics.map((t) => (
          <Link key={t.route} variant="subtle" className="fg-card hm-topic" href={pageHref(data, t.route)}>
            <h2 className="t-h3">{t.title}</h2>
            <p className="t-body t-muted">{t.text}</p>
            <Drawing name={t.art} width={104} className="hm-topic-art" />
          </Link>
        ))}
      </section>

      {changes && (
        <section className="hm-week" aria-labelledby="week-title">
          <header className="hm-week-head">
            <h2 id="week-title" className="t-h3">
              {changes.thisWeek ? 'What changed this week' : 'What changed lately'}
            </h2>
            <Link href={pageHref(data, 'changelog/')} className="fg-link">
              All release notes
            </Link>
          </header>
          {changes.recent.length === 0 ? (
            <p className="t-body t-muted">No changes recorded yet.</p>
          ) : (
            <ul className="hm-changes">
              {changes.recent.map((e, i) => (
                <li key={i}>
                  <Badge size="sm" className="hm-kind">
                    {e.kind}
                  </Badge>
                  <span className="t-body hm-change" title={e.title}>
                    {e.headline}
                  </span>
                  <span className="t-ui t-muted hm-date">{e.date}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}
