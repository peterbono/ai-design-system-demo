// Library > Foundations > Radius and borders, for any repo model: radius roles by rank on the objects that use them,
// the radius scale, border widths and the focus ring width.
import { Link } from '@bridge-ds/react';
import { RadiusSpecimen } from '../../../foundations/Specimens';
import { groupRows, primitiveRows } from '../../../../lib/library/foundations';
import { GroupSection, INERT, LibraryHeader, ScopeSwitch, TokenList } from '../FoundationParts';
import { pageHref, studioLink, type LibraryData } from '../library-data';

export const RADIUS_PAGE = {
  title: 'Radius and borders',
  art: 'foundations',
  studio: 'tokens/?focus=radius',
  lead: 'Radius tells you what kind of object you are looking at: small parts inside controls get the smallest, controls a little more, containers and overlays more again, pills are round. Design with the roles; brands set their values.',
} as const;

export default function RadiusView({ data }: { data: LibraryData }) {
  const { model } = data;
  const roles = groupRows(model, 'radius');
  const radii = primitiveRows(model, 'radius');
  const widths = [...groupRows(model, 'border-width'), ...primitiveRows(model, 'border.width')];
  const focus = groupRows(model, 'focus').filter((r) => r.type !== 'color');
  return (
    <div data-fd-page="">
      <LibraryHeader title={RADIUS_PAGE.title} art={RADIUS_PAGE.art} studio={studioLink(data, RADIUS_PAGE.studio)} canEdit={data.extras.canEdit}>
        {RADIUS_PAGE.lead}
      </LibraryHeader>

      <GroupSection id="roles" title="Radius roles" path="radius" count={roles.length} note="Each role on the components that use it, in the brand you pick here. Nested corners stay concentric: outer = inner + padding.">
        <div className="fd-spec-bar">
          <ScopeSwitch data={data} axis="brand" />
        </div>
        <div className="fd-stage" data-scope-stage="" {...INERT}>
          <RadiusSpecimen />
        </div>
        <TokenList data={data} rows={roles} preview="radius" label="Radius role tokens" />
      </GroupSection>

      <GroupSection id="scale" title="Radius scale" path="radius" count={radii.length} note="The raw values the roles point to. Reach for a role first; use the scale when you propose a new one.">
        <TokenList data={data} rows={radii} preview="radius" label="Radius scale tokens" />
      </GroupSection>

      <GroupSection id="borders" title="Border widths" path="border-width" count={widths.length} note="1 px for edges, 2 px for emphasis, selected states and active indicators.">
        <TokenList data={data} rows={widths} preview="stroke" label="Border width tokens" />
      </GroupSection>

      <GroupSection
        id="focus-ring"
        title="Focus ring"
        path="focus.ring"
        count={focus.length}
        note={
          <>
            Every focusable component draws the same ring, so keyboard users always know where they are. Its color is on the <Link href={pageHref(data, 'foundations/color/#focus-ring-color')}>Color page</Link>.
          </>
        }
      >
        <TokenList data={data} rows={focus} preview="stroke" label="Focus ring tokens" />
      </GroupSection>
    </div>
  );
}
