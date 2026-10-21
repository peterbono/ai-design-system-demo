// A team's Library, Components (multi-team PR 4a). Two views on one page, picked by the address:
//   /library/<owner>/<repo>/components/          every component as a card, by family, with search and family
//   /library/<owner>/<repo>/components/?c=<slug>  one component: its summary, one live story from the team's
//                                                 Storybook, then its usage guidance (docs.json) as text
// Bridge cannot run another team's components: previews are Storybook iframes (https only, sandboxed, lazy), and the
// docs.json examples are not drawn. Repo content is React text only; URLs go through lib/html.ts safeUrl.
import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Layers } from 'lucide-react';
import { Accordion, AccordionItem, Badge, Breadcrumb, Button, EmptyState, Input, Link, PageHeader, Select } from '@bridge-ds/react';
import ButtonLink from '../ButtonLink';
import UsagePanel from '../../UsagePanel';
import { GitHubMark } from '../studio/brand-icons';
import { LibraryPage, LibrarySourceNote, LibraryZone, usePageTeam } from './LibraryState';
import { componentFromQuery, hasGuidance, libraryComponents, type LibraryComponent } from '../../../lib/library-view';
import { filterTeamRows, httpsStorybook, teamFamilies } from '../../../lib/team-components';
import { libraryHref } from '../../../lib/library-shells';
import { fileUrl } from '../../../lib/team-load';
import { safeUrl } from '../../../lib/html';
import { storybookIframeUrl, storybookManagerUrl } from '@bridge-ds/core';
import type { TeamData } from '../../../scripts/team-data';
import '../../../styles/component.css';
import '../../../styles/team-components.css';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const STATUS_TONE = { stable: 'success', beta: 'info', deprecated: 'warning' } as const;
const STATUS_LABEL = { stable: 'Stable', beta: 'Beta', deprecated: 'Deprecated' } as const;

/** The family menu's "every family" choice (an empty value reads as no choice in the DS Select). */
const ALL = '__all__';

/** The address query, read after mount and on back/forward. */
function useSearch(): string | null {
  const [search, setSearch] = useState<string | null>(null);
  useEffect(() => {
    const read = () => setSearch(location.search);
    read();
    addEventListener('popstate', read);
    return () => removeEventListener('popstate', read);
  }, []);
  return search;
}

function Catalog({ data, list }: { data: TeamData; list: LibraryComponent[] }) {
  const [query, setQuery] = useState('');
  const [family, setFamily] = useState('');
  const families = useMemo(() => teamFamilies(list), [list]);
  const shown = filterTeamRows(list, query, family);
  if (!list.length) {
    const dir = data.model.components?.dir ?? data.model.config.components?.dir ?? 'components';
    return (
      <EmptyState
        icon={Layers}
        headingLevel={2}
        align="start"
        title={`No components found in ${dir}`}
        description="Bridge reads one folder per component (Name.tsx, its stories and Name.docs.json). Point components.dir in bridge.config.json at the folder that holds them."
      />
    );
  }
  return (
    <>
      <div className="tcm-tools" role="search">
        <Input label="Search components" hideLabel placeholder="Search by name, family or summary" value={query} onValueChange={setQuery} />
        <Select
          label="Family"
          hideLabel
          value={family || ALL}
          onValueChange={(v) => setFamily(!v || v === ALL ? '' : v)}
          options={[{ value: ALL, label: `All families (${list.length})` }, ...families.map((f) => ({ value: f.name, label: `${f.name} (${f.n})` }))]}
        />
      </div>
      <p className="ltm-muted" role="status" aria-live="polite">
        {shown.length === list.length ? `Showing all ${plural(list.length, 'component')}.` : `Showing ${shown.length} of ${list.length}.`}
      </p>
      {shown.length === 0 ? (
        <p className="ltm-muted">
          No component matches.{' '}
          <Button
            variant="link"
            onClick={() => {
              setQuery('');
              setFamily('');
            }}
          >
            Show every component
          </Button>
        </p>
      ) : (
        teamFamilies(shown).map((f) => (
          <section key={f.name} className="ltm-section" aria-label={f.name}>
            <h2 className="ltm-h2">
              {f.name} <span className="ltm-muted num">{f.n}</span>
            </h2>
            <ul className="ltm-cards">
              {shown
                .filter((c) => c.family === f.name)
                .map((c) => (
                  <li key={c.slug}>
                    <Link variant="subtle" className="fg-card ltm-card" href={libraryHref(data.owner, data.repo, `components/?c=${encodeURIComponent(c.slug)}`)}>
                      <span className="ltm-card-title">
                        <span className="ltm-card-name">{c.name}</span>
                        {c.status !== 'stable' && (
                          <Badge tone={STATUS_TONE[c.status]} size="sm">
                            {STATUS_LABEL[c.status]}
                          </Badge>
                        )}
                      </span>
                      <span className="ltm-card-text">{c.summary ?? 'No usage guidance yet.'}</span>
                      <span className="ltm-card-meta">
                        {plural(c.stories.length, 'story', 'stories')} · {hasGuidance(c.docs) ? 'Guidance' : 'No guidance'}
                      </span>
                    </Link>
                  </li>
                ))}
            </ul>
          </section>
        ))
      )}
    </>
  );
}

function Story({ storybook, c }: { storybook: string | undefined; c: LibraryComponent }) {
  const [id, setId] = useState(c.stories[0]?.id ?? '');
  const story = c.stories.find((s) => s.id === id) ?? c.stories[0];
  if (!storybook) {
    return (
      <div className="tp-locked">
        <p>
          <strong>Add the team's Storybook to see {c.name} live here.</strong> Set <span className="mono">storybook.url</span> in <span className="mono">bridge.config.json</span>.
        </p>
      </div>
    );
  }
  if (!story) return <p className="tp-locked">{c.name} has no story in the Storybook, so there is nothing to preview yet.</p>;
  return (
    <figure className="tcm-d-frame ltm-frame">
      <iframe
        key={story.id}
        src={storybookIframeUrl(storybook, story.id)}
        title={`${c.name}, story ${story.name}`}
        sandbox="allow-scripts allow-same-origin allow-popups"
        referrerPolicy="no-referrer"
        loading="lazy"
      />
      <figcaption className="ltm-frame-bar">
        {c.stories.length > 1 ? (
          <Select label="Story" hideLabel size="sm" value={story.id} onValueChange={(v) => v && setId(v)} options={c.stories.map((s) => ({ value: s.id, label: s.name }))} />
        ) : (
          <span className="ltm-muted">Story {story.name}</span>
        )}
        <span className="ltm-muted">From the team's Storybook.</span>
      </figcaption>
    </figure>
  );
}

function Detail({ data, c }: { data: TeamData; c: LibraryComponent }) {
  const storybook = httpsStorybook(data.storybook);
  const first = c.stories[0];
  const manager = storybook && first ? storybookManagerUrl(storybook, first.id) : '';
  const github = safeUrl(fileUrl(data.owner, data.repo, data.sha, c.file));
  const model = data.model.components?.list.find((x) => x.slug === c.slug);
  const tokens = model?.allTokenPaths ?? [];
  return (
    <>
      <Breadcrumb items={[{ label: 'Components', href: libraryHref(data.owner, data.repo, 'components/') }, { label: c.name }]} className="ltm-crumbs" />
      <PageHeader
        title={c.name}
        lead={c.summary ?? 'No summary yet.'}
        meta={
          <span className="ltm-meta">
            {c.family}
            <Badge tone={STATUS_TONE[c.status]} size="sm">
              {STATUS_LABEL[c.status]}
            </Badge>
          </span>
        }
        actions={
          <>
            {manager && (
              <ButtonLink variant="secondary" href={manager} iconEnd={ExternalLink} target="_blank" rel="noopener noreferrer">
                Open in Storybook
              </ButtonLink>
            )}
            {github && (
              <ButtonLink variant="ghost" href={github} iconStart={GitHubMark} target="_blank" rel="noopener noreferrer">
                View code
              </ButtonLink>
            )}
          </>
        }
      />
      <Story storybook={storybook} c={c} />
      <div className="ltm-usage">
        {hasGuidance(c.docs) ? (
          <UsagePanel docs={c.docs!} />
        ) : (
          <p className="ltm-muted">
            No usage guidance yet. Add <span className="mono">{model?.files.docs ?? `${c.name}.docs.json`}</span> next to the component to fill this page.
          </p>
        )}
      </div>
      {tokens.length > 0 && (
        <Accordion headingLevel={2}>
          <AccordionItem value="tokens" title="Tokens it paints with" meta={plural(tokens.length, 'token')}>
            <ul className="ltm-token-list">
              {tokens.map((t) => (
                <li key={t} className="mono">
                  {t}
                </li>
              ))}
            </ul>
          </AccordionItem>
        </Accordion>
      )}
    </>
  );
}

export default function LibraryComponents() {
  const team = usePageTeam();
  const search = useSearch();
  const slug = search ? new URLSearchParams(search).get('c') : null;
  return (
    <LibraryPage
      label="Reading the components"
      header={(data) =>
        slug ? null : (
          <LibraryZone
            title="Components"
            art="components"
            lead={
              data
                ? `${plural(libraryComponents(data.model).length, 'component')} of ${data.owner}/${data.repo}, by family. Each one opens its usage guidance and a live story.`
                : `The components of ${team ? `${team.owner}/${team.repo}` : 'this design system'}, by family, with their usage guidance.`
            }
          />
        )
      }
      ready={(data, r) => <Ready data={data} search={search ?? ''} {...r} />}
    />
  );
}

function Ready({ data, search, refreshing, onRefresh }: { data: TeamData; search: string; refreshing: boolean; onRefresh: () => void }) {
  const list = useMemo(() => libraryComponents(data.model), [data.model]);
  const slug = new URLSearchParams(search).get('c');
  const open = componentFromQuery(list, search);
  return (
    <>
      {slug && !open ? (
        <EmptyState
          icon={Layers}
          headingLevel={2}
          title={`No component named "${slug}"`}
          description="It may have been renamed or removed from the repository."
          actions={
            <ButtonLink variant="primary" href={libraryHref(data.owner, data.repo, 'components/')}>
              See every component
            </ButtonLink>
          }
        />
      ) : open ? (
        <Detail data={data} c={open} />
      ) : (
        <Catalog data={data} list={list} />
      )}
      <LibrarySourceNote data={data} refreshing={refreshing} onRefresh={onRefresh} />
    </>
  );
}
