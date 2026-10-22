// A team's Library, Components (src/pages/library-shell/components/): the same views as Bridge's own pages
// (views/ComponentsView.tsx, views/ComponentView.tsx), fed with the team's model read in the browser
// (scripts/team-data.ts) and what only its published snapshot carries (releases, motion). Two pages:
//   /library/<owner>/<repo>/components/         every component, by family, with search and family filter
//   /library/<owner>/<repo>/components/<slug>/  one component (shell components/item/, the slug from the address)
// An address from before component pages had their own (components/?c=<slug>) moves to the component's address.
// Previews come from the team's Storybook (bridge.config.json storybook.url, https only).
import { useEffect, useMemo, useState } from 'react';
import { Layers } from 'lucide-react';
import { Breadcrumb, EmptyState } from '@bridge-ds/react';
import type { RepoSnapshot } from '@bridge-ds/core';
import ButtonLink from '../ButtonLink';
import ScopeMenu from '../ScopeMenu';
import PropsPlayground from '../../PropsPlayground';
import ComponentFilter from './ComponentFilter';
import ComponentsView, { COMPONENTS_PAGE, componentFamilies } from './views/ComponentsView';
import ComponentView from './views/ComponentView';
import { LibraryPage, LibrarySourceNote, LibraryZone, usePageTeam } from './LibraryState';
import { teamLibraryData, type LibraryData } from './library-data';
import { playgroundSpec } from '../../../lib/library/components';
import { componentBySlug, componentSlugFromPath, mainStory, previewScopes } from '../../../lib/library/component-page';
import { httpsStorybook } from '../../../lib/team-components';
import { libraryHref } from '../../../lib/library-shells';
import { teamDisplayName } from '../../../lib/demo';
import { loadTeamSnapshot, resetTeamData, type TeamData } from '../../../scripts/team-data';
import '../../../styles/component.css';
import '../../../styles/library.css';
import '../../../styles/team-components.css';

export type LibraryComponentsPage = 'index' | 'item';

/** A refresh starts the page over: the page scripts bound to this view's markup start with the new one. */
const reload = () => {
  resetTeamData();
  location.reload();
};

/** The view's data: the team's model, its Storybook, its source on GitHub, and the snapshot's releases and motion. */
function componentData(data: TeamData, snap: RepoSnapshot | null): LibraryData {
  const base = teamLibraryData(data);
  const storybook = httpsStorybook(data.storybook);
  return {
    ...base,
    extras: {
      ...base.extras,
      ...(storybook ? { storybook } : {}),
      ...(snap?.releases ? { releases: snap.releases } : {}),
      ...(snap?.motion ? { motion: snap.motion } : {}),
      sourceBase: `https://github.com/${encodeURIComponent(data.owner)}/${encodeURIComponent(data.repo)}/blob/${encodeURIComponent(data.defaultBranch)}/`,
    },
  };
}

/** Starts what Bridge's static page starts at load, once the view is in the page. */
async function startPage(page: LibraryComponentsPage, data: TeamData) {
  const [script, shell] = await Promise.all([import('../../../scripts/component-page'), import('../../../scripts/shell')]);
  const root = document.documentElement;
  // The preview brand switch offers the team's brands, its default first; the previews start on it.
  const { brands } = previewScopes(data.model);
  root.dataset.brands = brands.map((b) => b.value).join(' ');
  if (!brands.some((b) => b.value === root.dataset.previewBrand)) root.dataset.previewBrand = data.model.tokens.rows.defaultBrand;
  if (page === 'item') script.initComponentPage();
  else {
    script.initComponentsIndex();
    shell.initToc();
  }
  shell.paintStaticSegments();
}

function Ready({ page, data, refreshing }: { page: LibraryComponentsPage; data: TeamData; refreshing: boolean }) {
  const [snap, setSnap] = useState<RepoSnapshot | null>(null);
  const slug = useMemo(() => (page === 'item' ? componentSlugFromPath(location.pathname) : null), [page]);
  const view = componentData(data, snap);
  const c = slug ? componentBySlug(data.model, slug) : undefined;
  useEffect(() => {
    let live = true;
    void loadTeamSnapshot().then((s) => live && setSnap(s));
    void startPage(page, data);
    if (c) document.title = document.title.replace(/^[^|]*\|/, `${c.name} |`);
    return () => {
      live = false;
    };
    // Once per page: a refresh reloads it (reload above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const source = <LibrarySourceNote data={data} refreshing={refreshing} onRefresh={reload} />;
  const all = libraryHref(data.owner, data.repo, 'components/');

  if (page === 'index') {
    return (
      <>
        <div>
          <ComponentsView data={view} tools={<ComponentFilter families={componentFamilies(view)} />} />
        </div>
        {source}
      </>
    );
  }
  if (!c) {
    return (
      <>
        <EmptyState
          icon={Layers}
          headingLevel={2}
          title={slug ? `No component named "${slug}"` : 'No component in this address'}
          description="It may have been renamed or removed from the repository."
          actions={
            <ButtonLink variant="primary" href={all}>
              See every component
            </ButtonLink>
          }
        />
        {source}
      </>
    );
  }
  const spec = playgroundSpec(c);
  const story = mainStory(c);
  const scopes = previewScopes(data.model);
  const storybook = view.extras.storybook;
  return (
    <>
      <div>
        <Breadcrumb items={[{ label: 'Components', href: all }, { label: c.name }]} className="shell-crumbs" />
        <ComponentView
        data={view}
        component={c}
        heroTools={scopes.brands.length > 1 || scopes.densities.length > 1 ? <ScopeMenu brands={scopes.brands} densities={scopes.densities} /> : undefined}
          playground={spec && story && storybook ? <PropsPlayground spec={spec} storybook={storybook} storyId={story.id} brands={scopes.brands} densities={scopes.densities} /> : undefined}
        />
      </div>
      {source}
    </>
  );
}

/** An old component address (components/?c=<slug>) moves to the component's own; true while it does. */
function useLegacyMove(page: LibraryComponentsPage): boolean {
  const team = usePageTeam();
  const [moving, setMoving] = useState(false);
  useEffect(() => {
    if (page !== 'index' || !team) return;
    const slug = new URLSearchParams(location.search).get('c');
    if (!slug || !/^[a-z0-9][a-z0-9-]*$/i.test(slug)) return;
    setMoving(true);
    location.replace(`${libraryHref(team.owner, team.repo, `components/${slug.toLowerCase()}/`)}${location.hash}`);
  }, [page, team]);
  return moving;
}

export default function LibraryTeamComponents({ page }: { page: LibraryComponentsPage }) {
  const team = usePageTeam();
  const moving = useLegacyMove(page);
  if (moving) return null;
  return (
    <LibraryPage
      label={page === 'index' ? 'Reading the components' : 'Reading the component'}
      // The page's own header comes with the view; while it reads, the same title and lead hold its place.
      header={(data) =>
        data || page === 'item' ? null : (
          <LibraryZone
            title={COMPONENTS_PAGE.title}
            art={COMPONENTS_PAGE.art}
            lead={`The components of ${team ? teamDisplayName(`${team.owner}/${team.repo}`) : 'this design system'}, by family, with their usage guidance.`}
          />
        )
      }
      ready={(data, r) => <Ready page={page} data={data} refreshing={r.refreshing} />}
    />
  );
}

