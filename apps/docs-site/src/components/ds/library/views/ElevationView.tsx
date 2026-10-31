// Library > Foundations > Elevation, for any repo model: elevation levels on real surfaces in both themes, then the
// shadow primitives behind them.
import { groupRows, primitiveRows } from '../../../../lib/library/foundations';
import { GroupSection, LibraryHeader, TokenGroup, TokenList } from '../FoundationParts';
import { pageHref, studioLink, type LibraryData } from '../library-data';
import { ConfluenceCopy } from '../ConfluenceCopy';

export const ELEVATION_PAGE = {
  title: 'Elevation',
  art: 'foundations',
  studio: 'tokens/?focus=shadow',
  lead: 'Things that float cast shadows; things that sit do not. Cards and panels are flat plates with a hairline edge. Only popovers, menus, dialogs, drawers and toasts get elevation, and dark mode uses darker, tighter shadows so edges stay visible.',
} as const;

export default function ElevationView({ data }: { data: LibraryData }) {
  const { model } = data;
  const shadows = primitiveRows(model, 'shadow');
  return (
    <div data-fd-page="">
      <LibraryHeader title={ELEVATION_PAGE.title} art={ELEVATION_PAGE.art} studio={studioLink(data, ELEVATION_PAGE.studio)} canEdit={data.extras.canEdit} actions={<ConfluenceCopy data={data} route={pageHref(data, 'foundations/elevation/')} />}>
        {ELEVATION_PAGE.lead}
      </LibraryHeader>

      <TokenGroup data={data} group="elevation" title="Levels" rows={groupRows(model, 'elevation')} preview="shadow" specimen="elevation" scope="brand" />

      <GroupSection id="primitives" title="Shadow primitives" path="shadow" count={shadows.length} note="The raw two-layer shadows. The dark variants exist because a light shadow disappears on a dark surface.">
        <TokenList data={data} rows={shadows} preview="shadow" label="Shadow primitive tokens" />
      </GroupSection>
    </div>
  );
}
