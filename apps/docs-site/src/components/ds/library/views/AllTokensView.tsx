// Library > All tokens, for any repo model: the Library's read-only reference. Every semantic token with its light
// and dark value (default brand), a filter, type chips and one side panel. Editing lives in Studio Tokens.
// scripts/all-tokens.ts drives it (deep links: ?t=<token path> selects a token; a primitive path fills the filter).
import { createElement } from 'react';
import { Button, Icon, IconButton, Input, Link, SegmentedControl } from '@bridge-ds/react';
import { ClipboardCopy, Search, X } from 'lucide-react';
import { allTokenRows, typeChips } from '../../../../lib/all-tokens';
import { jsonForScript } from '../../../../lib/html';
import { tokenAxes, tokenRows } from '../../../../lib/library/tokens';
import { studioLink, type LibraryData } from '../library-data';

const MODES = ['light', 'dark'];

export const ALL_TOKENS_PAGE = {
  title: 'All tokens',
  art: 'tokens',
  studio: 'tokens/',
  lead: 'Every semantic token with its light and dark value. Read only: copy a token\'s CSS variable, or open a token to see where its value comes from.',
} as const;

export default function AllTokensView({ data }: { data: LibraryData }) {
  const { model } = data;
  const rows = allTokenRows(tokenRows(model).all);
  const chips = typeChips(rows);
  const brand = tokenAxes(model).defaultBrand;
  const version = data.extras.version;
  const searchIcon = createElement(Icon, { icon: Search, size: 'sm' });
  // Type filter: a static DS SegmentedControl (data-vanilla), each type with its count; scripts/all-tokens.ts follows
  // it. The filter field and the type control share one DS size (md): a small SegmentedControl is taller than a small
  // Input (its track adds an inset around small-height segments), so the bar read as two heights.
  const chipItems = chips.map((c) => ({ value: c.value, label: createElement('span', null, `${c.label} `, createElement('span', { className: 'at-chip-n num' }, c.count)) }));
  // What the panel needs, keyed by path. Everything else is in the rendered rows.
  const panelData = Object.fromEntries(rows.map((r) => [r.path, { cssVar: r.cssVar, type: r.type, description: r.description, light: r.light, dark: r.dark }]));
  return (
    <div className="at" data-at="">
      <header className="at-head">
        <h1>All tokens</h1>
        <p className="at-lead">
          {version ? (
            <>
              Every semantic token in the latest release, <span className="mono">{version}</span>, with its light and dark value. Read only: copy a token's CSS variable, or open a token to see where its value comes from.
            </>
          ) : (
            ALL_TOKENS_PAGE.lead
          )}
        </p>
      </header>

      <div className="at-bar">
        <div className="at-filter">
          <Input size="md" type="search" label="Filter tokens" hideLabel placeholder={`Filter ${rows.length} tokens`} prefix={searchIcon} autoComplete="off" spellCheck={false} data-at-q />
        </div>
        <SegmentedControl className="at-chips" label="Type" size="md" data-vanilla data-at-chips value="all" items={chipItems} />
      </div>

      <div className="at-split">
        <section className="at-list" aria-labelledby="at-list-title">
          <h2 className="sr-only" id="at-list-title">
            Tokens
          </h2>
          <div className="at-lh" aria-hidden="true">
            <span></span>
            <span>Name</span>
            <span data-at-h-light="">Light</span>
            <span data-at-h-dark="">Dark</span>
            <span></span>
          </div>
          <ul className="at-rows" data-at-rows="">
            {rows.map((r) => (
              <li key={r.path} className="at-row" data-at-row={r.path} data-type={r.type} data-search={r.search} data-same={r.light.short === r.dark.short ? '' : undefined}>
                {/* bridge-audit-ignore-next-line: the whole token row (swatches, name, light and dark values) is one target that selects it; the DS has no row button and Button would truncate it to one label */}
                <button type="button" className="at-row-main" aria-controls="at-panel" aria-pressed="false" data-at-open={r.path}>
                  {r.type === 'color' ? (
                    <span className="at-sw" aria-hidden="true">
                      <i data-theme="light" data-brand={brand} data-scope-fixed="" style={{ backgroundColor: `var(${r.cssVar})` }} />
                      <i data-theme="dark" data-brand={brand} data-scope-fixed="" style={{ backgroundColor: `var(${r.cssVar})` }} />
                    </span>
                  ) : r.type === 'shadow' ? (
                    <span className="at-sw at-sw-shadow" aria-hidden="true">
                      <i style={{ boxShadow: `var(${r.cssVar})` }} />
                    </span>
                  ) : r.type === 'dimension' ? (
                    <span className="at-sw at-sw-dim" aria-hidden="true">
                      <i style={{ width: `min(var(${r.cssVar}), 100%)` }} />
                    </span>
                  ) : (
                    <span className="at-sw" aria-hidden="true" />
                  )}
                  <span className="at-name mono">
                    {r.cssVar}
                    {r.deprecated && <span className="at-dep">Deprecated</span>}
                  </span>
                  <span className="at-vals">
                    <span className="at-val mono">
                      <span className="sr-only">Light </span>
                      {r.light.short}
                    </span>
                    <span className="at-val mono">
                      <span className="sr-only">Dark </span>
                      {r.dark.short}
                    </span>
                  </span>
                </button>
                <IconButton icon={ClipboardCopy} label={`Copy variable var(${r.cssVar})`} size="sm" variant="secondary" className="at-copy" data-tooltip="Copy variable" data-copy={`var(${r.cssVar})`} />
              </li>
            ))}
          </ul>
          <p className="at-empty" data-at-empty="" hidden>
            No token matches this filter. Try a name like <span className="mono">bg.zone</span>, a CSS variable or a hex.
            <span data-at-elsewhere="" hidden>
              {' '}
              <span className="mono" data-at-elsewhere-name=""></span> is not a semantic token:{' '}
              <Link href={studioLink(data, 'tokens/')} data-at-elsewhere-link>
                see it in Studio Tokens
              </Link>
              .
            </span>
          </p>
        </section>

        <aside className="at-panel" id="at-panel" aria-label="Token detail" data-at-panel="" data-open="false" tabIndex={-1}>
          <div className="at-panel-head">
            <h2 className="at-panel-name mono" data-at-p-name=""></h2>
            <IconButton icon={X} label="Close token detail" size="sm" className="at-panel-close" data-at-close />
          </div>
          <p className="at-panel-desc" data-at-p-desc=""></p>
          <div className="at-modes">
            {MODES.map((m) => (
              <div key={m} className="at-mode" data-at-mode={m}>
                <div className="at-big" data-at-p-big="" data-theme={m} data-brand={brand} data-scope-fixed="">
                  <span className="mono" data-at-p-bigval=""></span>
                </div>
                <p className="at-mode-text">
                  <strong>{m === 'light' ? 'Light' : 'Dark'}</strong>
                  <span className="mono" data-at-p-source=""></span>
                  <span className="mono" data-at-p-value=""></span>
                </p>
              </div>
            ))}
          </div>
          <div className="at-var">
            <span className="mono" id="at-p-var" data-at-p-var=""></span>
            <Button variant="secondary" size="sm" iconStart={ClipboardCopy} data-copy-from="at-p-var">
              <span data-copy-label="">Copy variable</span>
            </Button>
          </div>
        </aside>
      </div>
      <div className="at-scrim" data-at-scrim="" hidden></div>
      <script type="application/json" id="at-data" dangerouslySetInnerHTML={{ __html: jsonForScript(panelData) }} />
    </div>
  );
}
