// Library > Foundations > Accessibility, for any repo model. Summary first: one status sentence from the contrast
// gate, then the gated pairs grouped by use for one brand and theme at a time (or all of them side by side), what
// every component guarantees (Bridge's own Library), and the method behind it, collapsed. Every number comes from the
// model's contrast checks file resolved against its tokens (lib/library/contrast.ts, lib/a11y-checks.ts).
// scripts/a11y-checks.ts drives the brand and theme controls and the compare toggle.
import { Badge, Button, Icon, Link, SegmentedControl } from '@bridge-ds/react';
import { CircleAlert, CircleCheck, Columns2, Moon, Sun } from 'lucide-react';
import ContrastMatrix, { type MatrixRow } from '../../../foundations/ContrastMatrix';
import { buildGroups, combos as makeCombos, groupStatus, resultFor, rowTitle, shortName, statusLabel, statusOf, statusSentence, summarize, type Status } from '../../../../lib/a11y-checks';
import { contrastFile, contrastPairs, evaluatePairs, THRESHOLDS } from '../../../../lib/library/contrast';
import { tokenAxes } from '../../../../lib/library/tokens';
import { LibraryHeader, vars } from '../FoundationParts';
import { studioLink, systemName, type LibraryData } from '../library-data';

const TONE: Record<Status, 'success' | 'neutral' | 'danger'> = { aaa: 'success', aa: 'neutral', fail: 'danger' };
const cssVar = (path: string) => `var(--${path.replace(/\./g, '-')})`;

export const ACCESSIBILITY_PAGE = {
  title: 'Accessibility',
  art: 'foundations',
  studio: 'quality/',
  studioLabel: 'Open in Studio',
  lead: 'Every gated color pair, checked in every brand and theme.',
} as const;

export default function AccessibilityView({ data }: { data: LibraryData }) {
  const { model } = data;
  const { brands, modes, defaultBrand, brandLabels } = tokenAxes(model);
  const extra = data.extras.extraPairs?.length ? evaluatePairs(model, data.extras.extraPairs) : [];
  const pairs = [...contrastPairs(model), ...extra];
  const COMBOS = makeCombos(brands, modes, brandLabels);
  const DEFAULT_KEY = `${defaultBrand}-${modes[0]}`;
  const summary = summarize(pairs, COMBOS);
  const groups = buildGroups(pairs, COMBOS);
  const pairName = (p: { fg: string; bg: string }) => `${shortName(p.fg)} on ${shortName(p.bg)}`;
  const matrixRows = (g: (typeof groups)[number]): MatrixRow[] =>
    g.pairs.map((p) => ({
      id: `${p.fg}|${p.bg}`,
      name: pairName(p),
      cells: COMBOS.map((c) => {
        const r = resultFor(p, c);
        const s = statusOf(r);
        return { key: c.key, ratio: r.ratio.toFixed(2), status: s, label: statusLabel(s, p.min), title: `${c.label}: ${rowTitle(p, r)}` };
      }),
    }));
  const name = systemName(data);
  const file = contrastFile(model);
  return (
    <>
      <LibraryHeader
        title={ACCESSIBILITY_PAGE.title}
        art={ACCESSIBILITY_PAGE.art}
        studio={studioLink(data, ACCESSIBILITY_PAGE.studio)}
        studioLabel={ACCESSIBILITY_PAGE.studioLabel}
        canEdit={data.extras.canEdit}
        actions={
          <Link href="#how-we-check" variant="standalone" data-a11y-how>
            How we check
          </Link>
        }
      >
        <p className="a11y-status" data-state={summary.failing ? 'fail' : 'pass'}>
          <Icon icon={summary.failing ? CircleAlert : CircleCheck} size="md" className="a11y-status-icon" />
          <span>{statusSentence(summary)}</span>
        </p>
      </LibraryHeader>

      <section className="a11y-checks" aria-labelledby="a11y-checks-h" data-a11y-checks="" data-view="list" data-combo={DEFAULT_KEY}>
        <h2 id="a11y-checks-h">Contrast checks</h2>
        <div className="a11y-bar">
          <div className="a11y-scope">
            <div className="a11y-field">
              <span className="a11y-field-label" id="a11y-brand-l">
                Brand
              </span>
              <SegmentedControl aria-labelledby="a11y-brand-l" size="sm" data-vanilla data-a11y-brand value={defaultBrand} items={brands.map((b) => ({ value: b, label: brandLabels[b] ?? b }))} />
            </div>
            <div className="a11y-field">
              <span className="a11y-field-label" id="a11y-mode-l">
                Theme
              </span>
              <SegmentedControl
                aria-labelledby="a11y-mode-l"
                size="sm"
                data-vanilla
                data-a11y-mode
                value={modes[0]}
                items={modes.map((m) => ({ value: m, label: m === 'light' ? 'Light' : 'Dark', icon: m === 'light' ? Sun : Moon }))}
              />
            </div>
          </div>
          <Button variant="secondary" size="sm" iconStart={Columns2} pressed={false} data-a11y-compare className="a11y-compare">
            {`Compare all ${COMBOS.length}`}
          </Button>
        </div>
        <p className="a11y-legend">
          <span>
            <span className="a11y-chip-key" data-s="aaa"></span>AAA: text at 7:1 or more
          </span>
          <span>
            <span className="a11y-chip-key" data-s="aa"></span>AA: meets the pair's minimum
          </span>
          <span>
            <Icon icon={CircleAlert} size="xs" className="a11y-fail-key" />
            Fails: below the minimum
          </span>
        </p>

        {groups.map((g) => (
          <details key={g.id} className="a11y-group" open={g.open} data-group={g.id} data-fails={g.failing.all ? '' : undefined}>
            <summary className="a11y-group-head">
              <h3 className="a11y-group-title">{g.label}</h3>
              {[...COMBOS.map((c) => c.key), 'all'].map((k) => (
                <span key={k} className="a11y-group-status" data-c={k} data-fails={g.failing[k] ? '' : undefined} hidden={k !== DEFAULT_KEY}>
                  {g.failing[k] ? <Icon icon={CircleAlert} size="sm" /> : null}
                  {k === 'all' ? `${groupStatus(g.pairs.length, g.failing[k]!)} in all ${COMBOS.length}` : groupStatus(g.pairs.length, g.failing[k]!)}
                </span>
              ))}
            </summary>
            <ul className="a11y-rows" aria-label={g.label}>
              {g.pairs.map((p) => {
                const first = resultFor(p, COMBOS[0]!);
                return (
                  <li key={`${p.fg}|${p.bg}`}>
                    {/* bridge-audit-ignore-next-line: the whole contrast row (tile, pair, ratio, Badge) is one target that opens the token drawer; the DS has no row button and Button would truncate it to one label */}
                    <button type="button" className="a11y-row" data-fd-open={p.fg} title={rowTitle(p, first)}>
                      <span className="a11y-tile" data-theme={COMBOS[0]!.mode} data-brand={COMBOS[0]!.brand} data-scope-fixed="" aria-hidden="true" style={{ backgroundColor: cssVar(p.bg) }}>
                        {p.usage === 'text' ? <span style={{ color: cssVar(p.fg) }}>Aa</span> : <i style={vars({ borderColor: cssVar(p.fg) })} />}
                      </span>
                      <span className="a11y-pair">
                        {`${shortName(p.fg)} `}
                        <span className="a11y-on">on</span>
                        {` ${shortName(p.bg)}`}
                      </span>
                      {COMBOS.map((c) => {
                        const r = resultFor(p, c);
                        const s = statusOf(r);
                        return (
                          <span key={c.key} className="a11y-res" data-c={c.key} data-title={rowTitle(p, r)} hidden={c.key !== DEFAULT_KEY}>
                            <span className="a11y-ratio num" data-s={s}>{`${r.ratio.toFixed(2)}:1`}</span>
                            <Badge tone={TONE[s]} icon={s === 'fail' ? CircleAlert : undefined} className="a11y-chip" title={s === 'fail' ? undefined : `Needs ${p.min}:1`}>
                              {statusLabel(s, p.min)}
                            </Badge>
                          </span>
                        );
                      })}
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="a11y-matrix" hidden>
              <ContrastMatrix label={g.label} combos={COMBOS.map((c) => ({ key: c.key, label: c.label }))} rows={matrixRows(g)} />
            </div>
          </details>
        ))}
      </section>

      {!data.team && (
        <section aria-labelledby="a11y-floor-h">
          <h2 id="a11y-floor-h">What every component guarantees</h2>
          <ul className="a11y-floor">
            <li>
              <strong>Keyboard and screen readers.</strong> Every interactive component is keyboard operable, with the right role, name and state. Behavior comes from native elements or Base UI parts.
            </li>
            <li>
              <strong>Visible focus.</strong> A 2px ring in the focus color, offset by 2px, on <code>:focus-visible</code> only. Inputs draw it inside the field.
            </li>
            <li>
              <strong>Color is never the only signal.</strong> Status has text and an icon; an invalid field has a message.
            </li>
            <li>
              <strong>Targets of at least 24 by 24 px</strong> in both densities.
            </li>
            <li>
              <strong>Reduced motion.</strong> With <code>prefers-reduced-motion: reduce</code>, every motion duration drops to 0.
            </li>
            <li>
              <strong>Checked in CI.</strong> Storybook runs the accessibility addon in error mode, and component tests run axe-core.
            </li>
          </ul>
        </section>
      )}

      <details className="a11y-how" id="how-we-check">
        <summary className="a11y-how-head">
          <h2>How we check</h2>
        </summary>
        <div className="a11y-how-body">
          <h3>Thresholds</h3>
          <p>
            {name} targets WCAG 2.2 AA. Text needs {THRESHOLDS.text.aa}:1 against its background, and reaches AAA at {THRESHOLDS.text.aaa}:1. Control edges, icons and focus rings need {THRESHOLDS.ui.aa}:1 (WCAG 1.4.11), which has no AAA level. Ratios are rounded down, so 4.496 never shows as a passing 4.50.
          </p>
          <h3>Text or UI</h3>
          <p>
            Each pair carries its own minimum. A pair gated at {THRESHOLDS.text.aa}:1 is text: body copy, labels, links, button text, chart axis labels. A pair gated at {THRESHOLDS.ui.aa}:1 is a UI part: borders, control tracks, icons, focus rings, chart series. Text samples show "Aa"; UI samples show a stroke.
          </p>
          <h3>The build gate</h3>
          <p>
            The pairs live in <code>{file}</code>. The token build resolves each one in every brand and theme and fails below its minimum, so a token change that breaks a pair never reaches the library. To gate a new combination, add <code>{'["<fg token>", "<bg token>", <min>]'}</code> to that file.
          </p>
          <h3>When a pair fails</h3>
          <ul>
            <li>Fix it with a token change, never locally in a screen or a component. A local fix hides the problem and the next team hits it again.</li>
            <li>Open an issue, or start an exploration in Studio and send it for review, with the pair, the ratio and where it shows up. A new token value needs the design owner's approval, then ships once the automatic checks pass.</li>
            <li>Until the fix is in the library, avoid that pair in new places.</li>
          </ul>
          {data.extras.canEdit !== false && (
            <p data-maintainer-only={data.extras.canEdit ? undefined : ''}>
              <Link href={studioLink(data, 'quality/')} variant="standalone">
                See every check in Studio Quality
              </Link>
            </p>
          )}
        </div>
      </details>
    </>
  );
}
