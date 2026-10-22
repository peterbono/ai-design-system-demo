// A page of a team's Library shell (src/pages/library-shell/, lib/library-shells.ts): the same view as Bridge's own
// Library page (components/ds/library/views/), fed with the team's model read in the browser (scripts/team-data.ts),
// behind the Library gate and its load and error states (LibraryState.tsx). Once the view is in the page, it starts
// what Bridge's static page starts at load: the token detail drawer (with the team's explorer data), copy and
// "Copy as", the brand and theme controls, the All tokens filter, the "On this page" rail, and the team's own token
// values on the previews (scripts/team-token-styles.ts).
import { useEffect, type ComponentType } from 'react';
import { LibraryPage, LibrarySourceNote, LibraryZone } from './LibraryState';
import { teamLibraryData, type LibraryData } from './library-data';
import ColorView, { COLOR_PAGE } from './views/ColorView';
import TypographyView, { TYPOGRAPHY_PAGE } from './views/TypographyView';
import SpacingView, { SPACING_PAGE } from './views/SpacingView';
import RadiusView, { RADIUS_PAGE } from './views/RadiusView';
import ElevationView, { ELEVATION_PAGE } from './views/ElevationView';
import AccessibilityView, { ACCESSIBILITY_PAGE } from './views/AccessibilityView';
import AllTokensView, { ALL_TOKENS_PAGE } from './views/AllTokensView';
import type { IllustrationName } from '../../../brand/illustrations';
import { libraryHref } from '../../../lib/library-shells';
import { resetTeamData, type TeamData } from '../../../scripts/team-data';

export type LibraryTeamPageName = 'color' | 'typography' | 'spacing' | 'radius' | 'elevation' | 'accessibility' | 'tokens';

interface PageDef {
  view: ComponentType<{ data: LibraryData }>;
  title: string;
  art: IllustrationName;
  lead: string;
  label: string;
}

const PAGES: Record<LibraryTeamPageName, PageDef> = {
  color: { view: ColorView, ...COLOR_PAGE, label: 'Reading the colors' },
  typography: { view: TypographyView, ...TYPOGRAPHY_PAGE, lead: TYPOGRAPHY_PAGE.teamLead, label: 'Reading the type scale' },
  spacing: { view: SpacingView, ...SPACING_PAGE, lead: SPACING_PAGE.teamLead, label: 'Reading the spacing' },
  radius: { view: RadiusView, ...RADIUS_PAGE, label: 'Reading radius and borders' },
  elevation: { view: ElevationView, ...ELEVATION_PAGE, label: 'Reading the elevation' },
  accessibility: { view: AccessibilityView, ...ACCESSIBILITY_PAGE, label: 'Reading the contrast checks' },
  tokens: { view: AllTokensView, ...ALL_TOKENS_PAGE, label: 'Reading the tokens' },
};

/** A refresh starts the page over: the page scripts bound to this view's markup start with the new one. */
const reload = () => {
  resetTeamData();
  location.reload();
};

/** Starts the page scripts on the view now in the page (each runs once per page). */
async function startPage(page: LibraryTeamPageName, data: TeamData) {
  const [{ explorerInputFromModel, writeExplorerData }, { initTokenDrawer }, { initFoundations }, shell, { applyTeamTokens }] = await Promise.all([
    import('../../../scripts/explorer/data'),
    import('../../../scripts/explorer/drawer'),
    import('../../../scripts/foundations'),
    import('../../../scripts/shell'),
    import('../../../scripts/team-token-styles'),
  ]);
  const { model } = data;
  const root = document.documentElement;
  // The preview brand switch offers the team's brands: the previews start on one of them.
  const brands = model.tokens.rows.brands;
  root.dataset.brands = brands.join(' ');
  if (!brands.includes(root.dataset.previewBrand ?? '')) root.dataset.previewBrand = model.tokens.rows.defaultBrand;
  applyTeamTokens(model);
  const comps = model.components?.list ?? [];
  const slugOf = (dir: string) => comps.find((c) => c.dir === dir)?.slug;
  writeExplorerData(
    explorerInputFromModel(model, {
      owner: data.owner,
      repo: data.repo,
      defaultBranch: data.defaultBranch,
      componentHref: (dir) => libraryHref(data.owner, data.repo, slugOf(dir) ? `components/${encodeURIComponent(slugOf(dir)!)}/` : 'components/'),
    }),
  );
  initTokenDrawer();
  if (page === 'accessibility') (await import('../../../scripts/a11y-checks')).initA11yChecks();
  else if (page === 'tokens') (await import('../../../scripts/all-tokens')).initAllTokens();
  else initFoundations();
  shell.paintStaticSegments();
  shell.initToc();
}

function Ready({ page, data, refreshing }: { page: LibraryTeamPageName; data: TeamData; refreshing: boolean }) {
  const View = PAGES[page].view;
  useEffect(() => {
    void startPage(page, data);
    // Once per page: a refresh reloads it (reload above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <>
      <div>
        <View data={teamLibraryData(data)} />
      </div>
      <LibrarySourceNote data={data} refreshing={refreshing} onRefresh={reload} />
    </>
  );
}

export default function LibraryTeamPage({ page }: { page: LibraryTeamPageName }) {
  const def = PAGES[page];
  return (
    <LibraryPage
      label={def.label}
      // The page's own header comes with the view; while it reads, the same title and lead hold its place.
      header={(data) => (data ? null : <LibraryZone title={def.title} lead={def.lead} art={def.art} />)}
      ready={(data, r) => <Ready page={page} data={data} refreshing={r.refreshing} />}
    />
  );
}
