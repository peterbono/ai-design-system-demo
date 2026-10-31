// Library > Foundations > Spacing, for any repo model: the density tokens in a real layout, then the space scale.
import { LayoutSpecimen } from '../../../foundations/Specimens';
import { foundationRow, primitiveRows } from '../../../../lib/library/foundations';
import { tokenRows } from '../../../../lib/library/tokens';
import { GroupSection, INERT, LibraryHeader, ScopeSwitch, TokenList } from '../FoundationParts';
import { pageHref, studioLink, type LibraryData } from '../library-data';
import { ConfluenceCopy } from '../ConfluenceCopy';

const DENSITY = ['layout.inset', 'layout.gap', 'control.gap', 'control.padding-x.sm', 'control.padding-x.md', 'control.padding-x.lg', 'table.cell-padding-x'];
const num = (css: string) => parseFloat(css) || 0;

export const SPACING_PAGE = {
  title: 'Spacing',
  art: 'foundations',
  studio: 'tokens/?focus=space',
  lead: 'A 4 px base scale: step n is n × 4 px, with half steps where controls need them. Tight inside groups, generous between them. Fewer choices means more consistent screens.',
  teamLead: 'The space scale and the density tokens built on it. Tight inside groups, generous between them. Fewer choices means more consistent screens.',
} as const;

export default function SpacingView({ data }: { data: LibraryData }) {
  const { model } = data;
  const steps = primitiveRows(model, 'space').sort((a, b) => num(a.values.light) - num(b.values.light));
  const known = new Set([...tokenRows(model).all, ...tokenRows(model).primitives].map((t) => t.path));
  const density = DENSITY.filter((p) => known.has(p)).map((p) => foundationRow(model, p));
  return (
    <div data-fd-page="">
      <LibraryHeader title={SPACING_PAGE.title} art={SPACING_PAGE.art} studio={studioLink(data, SPACING_PAGE.studio)} canEdit={data.extras.canEdit} actions={<ConfluenceCopy data={data} route={pageHref(data, 'foundations/spacing/')} />}>
        {data.team ? SPACING_PAGE.teamLead : SPACING_PAGE.lead}
      </LibraryHeader>

      <GroupSection
        id="in-layout"
        title="In a layout"
        note="A review card built from the real components. Tinted areas are spacing: card padding, the gap between blocks and the gap inside a row of controls. They come from density tokens: switch to Compact to tighten them."
      >
        <div className="fd-spec-bar">
          <ScopeSwitch data={data} axis="density" />
        </div>
        <div className="fd-stage" data-scope-stage="" {...INERT}>
          <LayoutSpecimen />
        </div>
        <TokenList data={data} rows={density} preview="space" label="Density spacing tokens" />
      </GroupSection>

      <GroupSection
        id="scale"
        title="Scale"
        path="space"
        count={steps.length}
        note="Inside a control: space 2 to 4. Between related items: space 1 to 3. Inside a card or panel: space 4 to 5. Between sections: space 8 and up."
      >
        <TokenList data={data} rows={steps} preview="space" label="Space tokens" />
      </GroupSection>
    </div>
  );
}
