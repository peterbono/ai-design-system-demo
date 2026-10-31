// Library > Foundations > Typography, for any repo model: the type scale at every step, weights, line heights,
// tracking and font families. Roles, line heights and tracking per step come from docs/DESIGN-LANGUAGE.md (section 5),
// mapped to the nearest token of the scale; a step the map does not know reads its token's own description.
import { primitiveRows, groupRows, type FoundationRow } from '../../../../lib/library/foundations';
import { GroupSection, LibraryHeader, ScopeSwitch, TokenList, v } from '../FoundationParts';
import { pageHref, studioLink, systemName, type LibraryData } from '../library-data';
import { ConfluenceCopy } from '../ConfluenceCopy';

export const TYPE_STEPS: Record<string, { role: string; leading: string; tracking: string }> = {
  '1000': { role: 'Display: the home hero and onboarding only (typography.display)', leading: 'none', tracking: 'tighter' },
  '900': { role: 'Numbers that must win a glance', leading: 'none', tracking: 'tighter' },
  '800': { role: 'Page titles (typography.h1)', leading: 'tight', tracking: 'tight' },
  '700': { role: 'Rare emphasis in dense views', leading: 'tight', tracking: 'tight' },
  '600': { role: 'Section titles (typography.h2), page titles on phones', leading: 'tight', tracking: 'snug' },
  '500': { role: 'Headings inside dense Studio views', leading: 'tight', tracking: 'snug' },
  '400': { role: 'Card, dialog and group titles (typography.h3)', leading: 'snug', tracking: 'snug' },
  '300': { role: 'Reading body and leads (typography.body)', leading: 'normal', tracking: 'normal' },
  '200': { role: 'Interface text, labels, table cells (typography.ui)', leading: 'normal', tracking: 'normal' },
  '100': { role: 'Captions, badges, table meta (typography.caption)', leading: 'snug', tracking: 'wide' },
};
const FALLBACK_STEP = { role: '', leading: 'normal', tracking: 'normal' };
export const TYPE_WEIGHTS: Record<string, string> = {
  'font.weight.regular': 'Body text.',
  'font.weight.medium': 'Labels and buttons.',
  'font.weight.semibold': 'Titles.',
  'font.weight.bold': 'Only for numbers that must win a glance.',
};
export const TYPE_LEADING: Record<string, string> = {
  'font.line-height.none': 'Icons and single glyphs, never text that wraps.',
  'font.line-height.tight': 'Headings from 24 px up.',
  'font.line-height.snug': 'Captions and card titles.',
  'font.line-height.normal': 'Body text and UI text that wraps.',
  'font.line-height.relaxed': 'Long reading, like changelogs and guidance.',
};
const withRole = (rows: FoundationRow[], roles: Record<string, string>) => rows.map((r) => ({ ...r, role: r.role || roles[r.path] || '' }));
const px = (css: string) => css.replace('px', ' px');
const lastOf = (path: string) => path.split('.').pop()!;

export const TYPOGRAPHY_PAGE = {
  title: 'Typography',
  art: 'foundations',
  studio: 'tokens/?focus=font',
  lead: 'Fraunces for display and page titles, Instrument Sans for reading and interface text, IBM Plex Mono for code and token names. Seven roles set size, line height and weight together; a screen uses four sizes at most. If a design needs a step that is not here, propose a token instead of picking a value by eye.',
  teamLead: 'The type scale at every step, with the weights, line heights, tracking and font families it pairs with. If a design needs a step that is not here, propose a token instead of picking a value by eye.',
} as const;

export default function TypographyView({ data }: { data: LibraryData }) {
  const { model } = data;
  const sizes = primitiveRows(model, 'font.size');
  const stepOf = (r: FoundationRow) => TYPE_STEPS[lastOf(r.path)];
  const sizeRows = withRole([...sizes].reverse(), Object.fromEntries(sizes.map((r) => [r.path, stepOf(r) ? `${stepOf(r)!.role}.` : ''])));
  const leadingRows = primitiveRows(model, 'font.line-height');
  const weights = withRole(primitiveRows(model, 'font.weight'), TYPE_WEIGHTS);
  const leading = withRole(leadingRows, TYPE_LEADING);
  const tracking = primitiveRows(model, 'font.tracking');
  const families = [...groupRows(model, 'font.family'), ...primitiveRows(model, 'font.family')];
  const lh = (name: string) => leadingRows.find((r) => r.path.endsWith(`.${name}`))?.values.light ?? '';
  return (
    <div data-fd-page="">
      <LibraryHeader title={TYPOGRAPHY_PAGE.title} art={TYPOGRAPHY_PAGE.art} studio={studioLink(data, TYPOGRAPHY_PAGE.studio)} canEdit={data.extras.canEdit} actions={<ConfluenceCopy data={data} route={pageHref(data, 'foundations/typography/')} />}>
        {data.team ? TYPOGRAPHY_PAGE.teamLead : TYPOGRAPHY_PAGE.lead}
      </LibraryHeader>

      <GroupSection id="scale" title="Type scale" path="font.size" count={sizes.length} note="Each step at its size, with the line height and tracking it pairs with.">
        <div className="fd-spec-bar">
          <ScopeSwitch data={data} axis="brand" />
        </div>
        <div className="fd-stage" data-scope-stage="" role="group" aria-label="Type scale specimen">
          {sizeRows.map((r) => {
            const step = lastOf(r.path);
            const s = TYPE_STEPS[step] ?? FALLBACK_STEP;
            const n = Number(step);
            return (
              <div key={r.path} className="sp-type-row">
                <span className="sp-type-meta">
                  <strong>{step}</strong>
                  <span>{`${px(r.values.light)} / ${lh(s.leading)}`}</span>
                  <span>{s.role || r.role}</span>
                </span>
                <p
                  className="sp-type-sample"
                  style={{
                    fontSize: v(r.path),
                    lineHeight: v(`font.line-height.${s.leading}`),
                    letterSpacing: v(`font.tracking.${s.tracking}`),
                    fontWeight: v(`font.weight.${n >= 400 ? 'semibold' : 'regular'}`),
                  }}
                >
                  {n >= 500 ? 'Review the token change' : 'Every token change ships as a reviewed pull request.'}
                </p>
              </div>
            );
          })}
        </div>
        <TokenList data={data} rows={sizeRows} preview="size" label="Font size tokens" />
      </GroupSection>

      <GroupSection id="weights" title="Weights" path="font.weight" count={weights.length}>
        <div className="fd-stage sp-type-weights" role="group" aria-label="Weight specimen">
          {weights.map((w) => (
            <div key={w.path}>
              <span className="sp-type-meta">
                <strong>{lastOf(w.path)}</strong>
                <span>{w.values.light}</span>
              </span>
              <p style={{ fontWeight: v(w.path), fontSize: 'var(--font-size-500)', lineHeight: 'var(--font-line-height-tight)' }}>Approve and add</p>
            </div>
          ))}
        </div>
        <TokenList data={data} rows={weights} preview="weight" label="Font weight tokens" />
      </GroupSection>

      <GroupSection id="leading" title="Line heights" path="font.line-height" count={leading.length}>
        <div className="fd-stage sp-type-leading" role="group" aria-label="Line height specimen">
          {leading
            .filter((l) => !l.path.endsWith('.none'))
            .map((l) => (
              <div key={l.path}>
                <span className="sp-type-meta">
                  <strong>{lastOf(l.path)}</strong>
                  <span>{l.values.light}</span>
                </span>
                <p style={{ lineHeight: v(l.path), fontSize: 'var(--font-size-200)' }}>
                  Semantic tokens give each color a job and point to a different primitive in each theme, so one change repaints every screen.
                </p>
              </div>
            ))}
        </div>
        <TokenList data={data} rows={leading} preview="line-height" label="Line height tokens" />
      </GroupSection>

      <GroupSection id="tracking" title="Tracking" path="font.tracking" count={tracking.length} note="Tighter as type gets bigger, slightly open at caption size. Values are in em, so they scale with the text.">
        <TokenList data={data} rows={tracking} preview="tracking" label="Tracking tokens" />
      </GroupSection>

      <GroupSection
        id="families"
        title="Families"
        path="font.family"
        count={families.length}
        note={
          data.team ? (
            <>
              Brands pick their faces through the font roles <code>font.family.display</code>, <code>font.family.sans</code> and <code>font.family.mono</code>. Each specimen below is set in {systemName(data)}'s own role.
            </>
          ) : (
            <>
              Brands pick their faces through the font roles <code>font.family.display</code>, <code>font.family.sans</code> and <code>font.family.mono</code>. Bridge sets Fraunces, Instrument Sans and IBM Plex Mono; Ocean uses IBM Plex throughout. All are self-hosted with <code>@bridge-ds/tokens/fonts.css</code>; without it, products fall back to the platform font.
            </>
          )
        }
      >
        <div className="fd-stage sp-type-families" role="group" aria-label="Font family specimen">
          <div>
            <span className="sp-type-meta">
              <strong>display</strong>
            </span>
            <p style={{ fontFamily: 'var(--font-family-display)' }}>Your design system, one source of truth</p>
          </div>
          <div>
            <span className="sp-type-meta">
              <strong>sans</strong>
            </span>
            <p style={{ fontFamily: 'var(--font-family-sans)' }}>Ship the system, not the slides</p>
          </div>
          <div>
            <span className="sp-type-meta">
              <strong>mono</strong>
            </span>
            <p style={{ fontFamily: 'var(--font-family-mono)' }}>color.bg.default 0O Il1</p>
          </div>
        </div>
        <TokenList data={data} rows={families} preview="family" label="Font family tokens" />
      </GroupSection>
    </div>
  );
}
