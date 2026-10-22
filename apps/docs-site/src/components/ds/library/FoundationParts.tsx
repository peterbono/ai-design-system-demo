// The parts every Library foundation page is built from, as React, so Bridge's own pages (rendered statically at
// build time) and a team's Library shell (rendered in the browser) draw the same markup: the page header (the Harbor
// zone), the compact preview switch, a token group in context in both themes, and the token list. Page scripts
// (scripts/foundations.ts, scripts/explorer/drawer.ts, scripts/shell.ts) drive them through their data attributes.
// Token paths reach inline styles only as var() of a checked custom property name; labels are React text.
import type { CSSProperties, ReactNode } from 'react';
import { Button, Icon, IconButton, Link, SegmentedControl } from '@bridge-ds/react';
import { ChevronRight, Copy, Pencil } from 'lucide-react';
import ButtonLink from '../ButtonLink';
import { Drawing } from '../studio/Drawing';
import Specimen, { type SpecimenGroup } from '../../foundations/Specimens';
import { siteIcon } from '../../../brand/site-icons';
import type { IllustrationName } from '../../../brand/illustrations';
import type { FoundationRow } from '../../../lib/library/foundations';
import { anchorOf } from '../../../lib/library/token-href';
import { DENSITY_LABEL, tokenAxes, type Mode } from '../../../lib/library/tokens';
import { groupTitle } from '../../../lib/library-rows';
import { libraryLink, type LibraryData } from './library-data';

/** A CSS custom property reference for a token path, or a reference that resolves to nothing for a name CSS rejects. */
export const v = (path: string): string => {
  const name = `--${path.replace(/\./g, '-')}`;
  return /^--[A-Za-z0-9_-]+$/.test(name) ? `var(${name})` : 'var(--bridge-invalid-token)';
};

/** Specimens never take focus or clicks (React 18 has no typed `inert` prop). */
export const INERT = { inert: '' } as Record<string, string>;

/** Custom properties as a React style object. */
export const vars = (style: Record<string, string>): CSSProperties => style as CSSProperties;

/**
 * Library section page header: a Harbor zone block with the page title, the lead and an ink drawing on the end side.
 * `studio` is where the page is edited: a quiet "Edit in Studio" button for maintainers (data-maintainer-only on
 * Bridge's own Library; on a team's Library, for a signed-in reader: its Studio decides what they may do).
 */
export function LibraryHeader({
  title,
  art,
  studio,
  studioLabel = 'Edit in Studio',
  canEdit,
  actions,
  children,
}: {
  title: string;
  art?: IllustrationName;
  studio?: string;
  studioLabel?: string;
  /** Undefined: maintainers only (data-maintainer-only). True or false: shown or not. */
  canEdit?: boolean;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="zone lib-zone">
      <header className="lib-zone-text lib-page-header">
        <h1 className="lib-title">{title}</h1>
        <div className="lib-lead">{children}</div>
        {actions && <div className="lib-actions">{actions}</div>}
      </header>
      {studio && canEdit !== false && (
        <span className="lib-studio" data-maintainer-only={canEdit ? undefined : ''}>
          <ButtonLink variant="ghost" size="sm" iconStart={Pencil} href={studio}>
            {studioLabel}
          </ButtonLink>
        </span>
      )}
      {art && <Drawing name={art} width={112} className="lib-zone-art" />}
    </section>
  );
}

/**
 * Compact brand or density switch in a specimen header, only when the system has more than one: a static DS
 * SegmentedControl (data-vanilla) that scripts/shell.ts drives as the one preview scope of the site. The label sits
 * outside the track, as a caption to its left. Its `value` is fixed, never `defaultValue`: rendered in the browser (a
 * team's Library), React then leaves the selection to the script, as on the static page.
 */
export function ScopeSwitch({ data, axis }: { data: LibraryData; axis: 'brand' | 'density' }) {
  const { brands, brandLabels, densities } = tokenAxes(data.model);
  const options = axis === 'brand' ? brands.map((b) => ({ value: b, label: brandLabels[b] ?? b })) : densities.map((d) => ({ value: d, label: DENSITY_LABEL[d] ?? d }));
  if (options.length <= 1) return null;
  const name = axis === 'brand' ? 'Preview brand' : 'Preview density';
  // Several switches can share a page (one per color group): each label needs its own id.
  const labelId = `fd-scope-${axis}-${Math.random().toString(36).slice(2, 8)}`;
  return (
    <div className="fd-scope-field">
      <span className="fd-scope-label" id={labelId}>
        {name}
      </span>
      <SegmentedControl aria-labelledby={labelId} data-vanilla data-scope-switch={axis} value={options[0]!.value} items={options} />
    </div>
  );
}

/**
 * A token group in context, once per theme side by side (stacked on narrow screens). Each panel sets data-theme, so
 * the documented system's tokens resolve inside it; the shell adds the preview brand and density. The panels are
 * inert: the list and the detail drawer carry every value.
 */
export function SpecimenPair({ data, group, label, scope }: { data: LibraryData; group: SpecimenGroup; label: string; scope?: 'brand' | 'density' }) {
  const { modes } = tokenAxes(data.model);
  return (
    <>
      {scope && (
        <div className="fd-spec-bar">
          <ScopeSwitch data={data} axis={scope} />
        </div>
      )}
      <div className="fd-spec" role="group" aria-label={label}>
        {modes.map((m) => (
          <figure key={m} className="fd-spec-panel" data-theme={m}>
            <figcaption className="fd-spec-mode">
              <Icon icon={siteIcon(m === 'light' ? 'sun' : 'moon')} size="sm" className="icon" />
              {m === 'light' ? 'Light' : 'Dark'}
            </figcaption>
            <div className="fd-spec-body" {...INERT}>
              <Specimen group={group} mode={m} />
            </div>
          </figure>
        ))}
      </div>
    </>
  );
}

export type Preview = 'color' | 'shadow' | 'space' | 'radius' | 'stroke' | 'size' | 'weight' | 'line-height' | 'tracking' | 'family' | 'none';

type ColorKind = 'fill' | 'text' | 'border' | 'ring';
const colorKind = (path: string): ColorKind => {
  if (path === 'focus.ring.color') return 'ring';
  if (/^color\.border\./.test(path) || /\.border$/.test(path)) return 'border';
  if (/^color\.text\./.test(path) || /\.(text|fg|icon)$/.test(path)) return 'text';
  return 'fill';
};
/** Background a foreground token is meant to sit on, so "Aa" reads as it does in a product. */
const onFor = (path: string): string => {
  if (path === 'color.text.inverse') return v('color.surface.inverse');
  if (path === 'color.text.on-solid') return v('color.feedback.info.solid');
  if (path === 'color.control.checked.fg') return v('color.control.checked.bg');
  const action = path.match(/^color\.action\.(\w+)\.text$/);
  if (action && action[1] !== 'ghost' && action[1] !== 'disabled') return v(`color.action.${action[1]}.bg`);
  if (path === 'color.action.disabled.text') return v('color.action.disabled.bg');
  const fb = path.match(/^color\.feedback\.(\w+)\.(text|icon)$/);
  if (fb) return v(`color.feedback.${fb[1]}.bg`);
  return v('color.bg.default');
};
const dual = (r: FoundationRow) => r.tier !== 'primitive' && (r.type === 'color' || r.type === 'shadow');
const valueText = (r: FoundationRow) => (r.type === 'color' ? '' : r.values.light === r.values.dark ? r.values.light : `${r.values.light} · ${r.values.dark}`);

/**
 * The light token list of a foundation page: one row per token with a preview (a dual light and dark swatch for
 * colors and shadows, a shape, bar or sample otherwise), the name once (a click copies it; the copy button copies
 * the CSS variable, or the last format picked in its menu), a one-line role, a muted alias line and a usage chip.
 * A click on the row opens the token detail drawer.
 */
export function TokenList({ data, rows, preview, label }: { data: LibraryData; rows: FoundationRow[]; preview: Preview; label: string }) {
  const { modes } = tokenAxes(data.model);
  return (
    <ul className={`fd-list is-${preview}`} aria-label={label}>
      {rows.map((r) => {
        const kind = r.type === 'color' ? colorKind(r.path) : null;
        const value = r.type === 'shadow' ? '' : valueText(r);
        return (
          <li key={r.path} className="fd-row" id={anchorOf(r.cssVar)} data-fd-row={r.path}>
            <span className={`fd-pv is-${preview}${kind ? ` is-${kind}` : ''}`} aria-hidden="true">
              {dual(r) ? (
                modes.map((m: Mode) => (
                  <span key={m} className="fd-pv-half" data-theme={m} style={vars({ '--pv': v(r.path), '--on': kind ? onFor(r.path) : v('color.bg.default') })}>
                    {kind === 'text' ? <span className="fd-pv-aa">Aa</span> : <span className="fd-pv-chip" />}
                  </span>
                ))
              ) : preview === 'shadow' ? (
                <span className="fd-pv-half" style={vars({ '--pv': v(r.path), '--on': v('color.bg.default') })}>
                  <span className="fd-pv-chip" />
                </span>
              ) : preview === 'size' || preview === 'weight' || preview === 'family' || preview === 'tracking' ? (
                <span className="fd-pv-type" style={vars({ '--pv': v(r.path) })}>
                  {preview === 'tracking' ? 'Tokens' : 'Aa'}
                </span>
              ) : preview === 'line-height' ? (
                <span className="fd-pv-lines" style={vars({ '--pv': v(r.path) })}>
                  <span />
                  <span />
                  <span />
                </span>
              ) : preview === 'none' ? null : (
                <span className="fd-pv-shape" style={vars({ '--pv': v(r.path) })} />
              )}
            </span>
            <span className="fd-main">
              <span className="fd-name-line">
                {/* bridge-audit-ignore-next-line: the token name itself is the copy target, in Plex Mono at body size; a DS Button would restyle the name. The DS copy button beside it does the same job */}
                <button type="button" className="fd-name" data-fd-copy="" data-copy-css={r.copy.css} data-copy-js={r.copy.js} data-copy-figma={r.copy.figma} title={`Copy CSS variable ${r.copy.css}`}>
                  {r.path}
                </button>
                <span className="fd-copy">
                  <IconButton icon={Copy} variant="ghost" size="sm" className="fd-copy-btn" label={`Copy CSS variable ${r.copy.css}`} title="Copy CSS variable" data-fd-copy="" data-fd-copy-icon data-copy-css={r.copy.css} data-copy-js={r.copy.js} data-copy-figma={r.copy.figma} />
                  <details className="fd-copy-more" data-menu="">
                    <summary className="fd-copy-chev" aria-label={`Other copy formats for ${r.path}`} title="Copy as">
                      <Icon icon={siteIcon('chevronDown')} size="xs" className="icon" />
                    </summary>
                    <div className="fd-copy-menu" role="menu" aria-label={`Copy ${r.path} as`}>
                      <Button variant="ghost" size="sm" role="menuitemradio" aria-checked="true" data-fd-copy-as="css">
                        Copy CSS variable
                      </Button>
                      <Button variant="ghost" size="sm" role="menuitemradio" aria-checked="false" data-fd-copy-as="js">
                        Copy as JS
                      </Button>
                      <Button variant="ghost" size="sm" role="menuitemradio" aria-checked="false" data-fd-copy-as="figma">
                        Copy Figma name
                      </Button>
                    </div>
                  </details>
                </span>
              </span>
              {r.role && <span className="fd-role">{r.role}</span>}
            </span>
            <span className="fd-ref">
              {value && <span className="fd-value">{value}</span>}
              {r.alias && <span className="fd-alias">{r.alias}</span>}
            </span>
            <span className="fd-use">
              {r.chip.kind === 'unused' ? (
                <span className="fd-chip is-unused">{r.chip.label}</span>
              ) : (
                <details className="fd-uses" data-menu="">
                  <summary className="fd-chip" aria-label={`${r.chip.label}, see who uses ${r.path}`}>
                    {r.chip.label}
                  </summary>
                  <div className="fd-pop">
                    {r.components.length > 0 && (
                      <>
                        <p className="fd-pop-title">Components</p>
                        <ul className="fd-pop-list">
                          {r.components.map((c) => (
                            <li key={c.name}>
                              <Link href={libraryLink(data, c.href)}>{c.name}</Link>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                    {r.base.length > 0 && (
                      <>
                        <p className="fd-pop-title">Base styles</p>
                        <p className="fd-pop-note">
                          {'Read by '}
                          {r.base.map((f) => (
                            <code key={f}>{f}</code>
                          ))}
                          , the global stylesheet apps import once with <code>@bridge-ds/react/styles.css</code>.
                        </p>
                      </>
                    )}
                    {r.components.length === 0 && r.base.length === 0 && <p className="fd-pop-note">In use through a token that aliases it. Open the details to follow the chain.</p>}
                  </div>
                </details>
              )}
            </span>
            <IconButton icon={ChevronRight} label={`Open details for ${r.path}`} title="Open details" size="sm" className="ds-fd-open" data-fd-open={r.path} />
          </li>
        );
      })}
    </ul>
  );
}

/** One section of a foundation page: heading with the group path and its count, an optional note, then the list. */
export function GroupSection({ id, title, path, count, note, children }: { id: string; title: string; path?: string; count?: number; note?: ReactNode; children: ReactNode }) {
  return (
    <section className="fd-group" aria-labelledby={id}>
      <header className="fd-group-head">
        <h2 id={id}>{title}</h2>
        {path && <code className="fd-group-path">{path}</code>}
        {count !== undefined && <span className="fd-group-n">{`${count} tokens`}</span>}
      </header>
      {note && <p className="fd-group-note">{note}</p>}
      {children}
    </section>
  );
}

/**
 * One token group of a foundation page: heading, the group's usage note, the specimen in both themes, then the
 * list. Visual first, detail on demand (a row opens the detail drawer).
 */
export function TokenGroup({
  data,
  group,
  rows,
  preview,
  specimen,
  scope,
  title = groupTitle(group),
  note = data.extras.groupNotes?.[group] ?? '',
}: {
  data: LibraryData;
  group: string;
  rows: FoundationRow[];
  preview: Preview;
  specimen?: SpecimenGroup;
  title?: string;
  note?: string;
  scope?: 'brand' | 'density';
}) {
  const id = `g-${group.replace(/\./g, '-')}`;
  return (
    <section className="fd-group" aria-labelledby={id}>
      <header className="fd-group-head">
        <h2 id={id}>{title}</h2>
        <code className="fd-group-path">{group}</code>
        <span className="fd-group-n">{`${rows.length} ${rows.length === 1 ? 'token' : 'tokens'}`}</span>
      </header>
      {note && <p className="fd-group-note">{note}</p>}
      {specimen && <SpecimenPair data={data} group={specimen} scope={scope} label={`${title} tokens in light and dark`} />}
      <TokenList data={data} rows={rows} preview={preview} label={`${title} tokens`} />
    </section>
  );
}
