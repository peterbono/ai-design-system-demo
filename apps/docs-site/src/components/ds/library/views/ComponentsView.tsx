// Library > Components, for any repo model: every component as a card, by family, with its counts. Bridge's own page
// (pages/components/index.astro) renders it at build time, a team's Library in the browser (LibraryTeamComponents.tsx).
// A card previews its component: with the real component when the Library runs it (`Example`, Bridge's own), else
// with its first story from the design system's Storybook (lazy, inert). The search and family filter come in as
// `tools` (ComponentFilter, a hydrated island on a static page); it hides cards through their data attributes.
import type { ComponentType, ReactNode } from 'react';
import { Badge, Link } from '@bridge-ds/react';
import type { ExampleNode } from '@bridge-ds/core';
import type { ComponentInfo } from '../../../../lib/library/components';
import { componentGroups, familySlug, mainStory, previewUrl, readableDocs, STATUS_LABEL, STATUS_TONE, statusOf } from '../../../../lib/library/component-page';
import { LibraryHeader, INERT } from '../FoundationParts';
import { componentHref, studioLink, type LibraryData } from '../library-data';

export const COMPONENTS_PAGE = { title: 'Components', art: 'components', studio: 'components/' } as const;

const plural = (n: number, w: string, many = `${w}s`) => `${n} ${n === 1 ? w : many}`;

/** "53 components in 9 families. Each page has the same tabs: ..." */
export const componentsLead = (total: number, families: number) =>
  `${plural(total, 'component')} in ${plural(families, 'family', 'families')}. Each page has the same tabs: Usage (when to use it, do and don't, accessibility), Tokens, Code (props and a playground) and Changelog. Guidance first, specs second.`;

/** The families of a model with their counts, for the family filter. */
export const componentFamilies = (data: Pick<LibraryData, 'model'>) => componentGroups(data.model).groups.map((g) => ({ name: g.family, n: g.list.length }));

function CardStage({ data, c, Example }: { data: LibraryData; c: ComponentInfo; Example?: ComponentType<{ node: ExampleNode }> | undefined }) {
  const preview = readableDocs(c.docs)?.preview;
  const story = mainStory(c);
  const storybook = data.extras.storybook;
  return (
    <div className="gcard-stage stage-checker" data-theme="light" aria-hidden="true" {...INERT}>
      {Example && preview ? (
        <Example node={preview} />
      ) : !Example && story && storybook ? (
        <iframe className="gcard-frame" src={previewUrl(storybook, story.id, { theme: 'light' })} title={`${c.name} preview`} tabIndex={-1} loading="lazy" sandbox="allow-scripts allow-same-origin" referrerPolicy="no-referrer" />
      ) : (
        <span className="gcard-empty">No preview yet</span>
      )}
    </div>
  );
}

export default function ComponentsView({ data, Example, tools }: { data: LibraryData; Example?: ComponentType<{ node: ExampleNode }> | undefined; tools?: ReactNode }) {
  const { groups, total, documented } = componentGroups(data.model);
  return (
    <>
      <LibraryHeader title={COMPONENTS_PAGE.title} art={COMPONENTS_PAGE.art} studio={studioLink(data, COMPONENTS_PAGE.studio)} studioLabel="Open in Studio" canEdit={data.extras.canEdit}>
        {componentsLead(total, groups.length)}
      </LibraryHeader>
      <p className="gallery-stats">
        <Badge>{plural(total, 'component')}</Badge>
        <Badge tone="success">{documented} with usage guidance</Badge>
        {total - documented > 0 && <Badge tone="warning">{total - documented} missing guidance</Badge>}
      </p>
      {tools}

      {groups.map(({ family, list }) => (
        <details key={family} className="gallery-group family" id={`fam-${familySlug(family)}`} open data-cfam={family}>
          <summary>
            <h2>{family}</h2>
            <span className="family-count">{list.length}</span>
          </summary>
          <ul className="gallery">
            {list.map((c) => {
              const docs = readableDocs(c.docs);
              const status = statusOf(c);
              const summary = docs?.summary || c.description || 'No usage guidance yet.';
              return (
                <li key={c.slug} className="gcard" data-ccard="" data-cname={c.name} data-cfamily={family} data-csummary={docs?.summary ?? ''}>
                  <CardStage data={data} c={c} Example={Example} />
                  <div className="gcard-body">
                    <div className="gcard-title">
                      <h3>
                        <Link href={componentHref(data, c.slug)}>{c.name}</Link>
                      </h3>
                      <Badge tone={STATUS_TONE[status]} size="sm">
                        {STATUS_LABEL[status]}
                      </Badge>
                    </div>
                    <p>{summary}</p>
                    <dl className="gcard-stats">
                      <div>
                        <dt>Props</dt>
                        <dd className="num">{c.props.length}</dd>
                      </div>
                      <div>
                        <dt>Tokens</dt>
                        <dd className="num">{c.allTokenPaths.length}</dd>
                      </div>
                      <div>
                        <dt>Stories</dt>
                        <dd className="num">{c.stories.length}</dd>
                      </div>
                    </dl>
                  </div>
                </li>
              );
            })}
          </ul>
        </details>
      ))}
    </>
  );
}
