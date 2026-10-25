// Studio Components: every component in one DS Table, grouped by family under small row-group headers. Each row
// starts with a calm thumbnail of the real component (one sample of its Library preview, never a destructive one:
// lib/components-studio thumbnailNode; rendered at build time and scaled to fit by scripts/components-studio.ts; a
// component without a preview shows an empty frame, never a stand-in image), then what a designer reads, in words:
// the products that use it as tags (from the committed `bridge audit` reports), examples and tokens. Badges only for exceptions (missing guidance, a Claude
// draft to review, beta, deprecated). The whole row opens the detail drawer: rows are one tab stop with arrow keys
// between them, Enter opens.
//
// Two hosts: the self-hosted Studio page (pages/studio/components, rendered at build time, Thumb = Example, the rows
// driven by scripts/components-studio.ts) and a team's Studio page (TeamComponents.tsx, in the browser, Thumb =
// ClientExample, `onOpen` wires the rows here).
import type { ComponentType, KeyboardEvent } from 'react';
import { Avatar, Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Tag, type BadgeTone } from '@bridge-ds/react';
import type { ExampleNode, GuidanceState } from '../../../lib/components';
import { thumbnailNode, usedInCell } from '../../../lib/components-studio';

export interface ComponentListRow {
  slug: string;
  name: string;
  family: string;
  status: 'stable' | 'beta' | 'deprecated';
  guidance: GuidanceState;
  /** Tokens it paints with, own and inherited (own and inherited are counted together). */
  tokensTotal: number;
  /** Storybook stories, shown to designers as examples. */
  examples: number;
  /** The Library preview (docs.json "preview"), rendered as the thumbnail. */
  preview?: ExampleNode | undefined;
  /** Products that use it, from the audit reports; undefined when no report exists (the column is left out). */
  usedIn?: { product: string; instances: number }[] | undefined;
  /** Whether it is in the Figma UI kit (component-specs.json coverage): a word and the reason when it is not. */
  figma?: { label: string; title?: string } | undefined;
}

/** The exception badges of a row, in the Studio status colors: violet waits for someone, grey for the rest. */
export function exceptions(r: Pick<ComponentListRow, 'guidance' | 'status'>): { label: string; tone: BadgeTone; short?: string; agent?: boolean }[] {
  const out: { label: string; tone: BadgeTone; short?: string; agent?: boolean }[] = [];
  if (r.guidance === 'missing') out.push({ label: 'Missing guidance', tone: 'neutral', short: 'No guidance' });
  if (r.guidance === 'review') out.push({ label: 'Draft by Claude, needs review', tone: 'info', short: 'Needs review', agent: true });
  if (r.status === 'beta') out.push({ label: 'Beta', tone: 'neutral' });
  if (r.status === 'deprecated') out.push({ label: 'Deprecated', tone: 'neutral' });
  return out;
}

/** Thumbnails show; they never take focus or clicks (React 18 has no typed `inert` prop). */
const INERT = { inert: '' } as Record<string, string>;

const words = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

export interface ComponentsListProps {
  rows: ComponentListRow[];
  /** Audited products: the "Used in" column shows only when there is one. */
  products: number;
  /** Draws a thumbnail sample (Example at build time, ClientExample in the browser). */
  Thumb: ComponentType<{ node: ExampleNode }>;
  /** Opens a row's drawer. Without it the page script drives the rows (scripts/components-studio.ts). */
  onOpen?: (slug: string) => void;
  /** The row whose drawer is open (with onOpen). */
  openSlug?: string | null;
}

/** Arrow keys move between the rows of the list, Enter and Space open one (with onOpen). */
function rowKeys(e: KeyboardEvent<HTMLTableRowElement>, open: () => void) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    open();
    return;
  }
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const table = e.currentTarget.closest('table');
  const rows = table ? [...table.querySelectorAll<HTMLTableRowElement>('[data-cm-row]:not([hidden])')] : [];
  const at = rows.indexOf(e.currentTarget);
  const next = rows[e.key === 'ArrowDown' ? at + 1 : at - 1];
  if (!next) return;
  e.preventDefault();
  for (const r of rows) r.tabIndex = r === next ? 0 : -1;
  next.focus();
}

export default function ComponentsList({ rows, products, Thumb, onOpen, openSlug }: ComponentsListProps) {
  const families = [...new Set(rows.map((r) => r.family))];
  const withUsage = products > 0;
  const withFigma = rows.some((r) => r.figma);
  const cols = 3 + (withUsage ? 1 : 0) + (withFigma ? 1 : 0);
  return (
    <Table aria-label="Components by family. Arrow keys move between rows, Enter opens one." className="cm-table" data-cm-table="">
      <TableHeader>
        <TableRow>
          <TableHead>Component</TableHead>
          {withUsage && <TableHead className="cm-col-used">Used in</TableHead>}
          <TableHead className="cm-col-dev">Examples</TableHead>
          <TableHead className="cm-col-dev">Tokens</TableHead>
          {withFigma && <TableHead className="cm-col-dev">In Figma</TableHead>}
        </TableRow>
      </TableHeader>
      {families.map((family) => (
        <TableBody key={family} data-cm-family={family}>
          <TableRow className="cm-fam">
            <TableHead scope="rowgroup" colSpan={cols}>
              {family}
            </TableHead>
          </TableRow>
          {rows
            .filter((r) => r.family === family)
            .map((r) => (
              <TableRow
                key={r.slug}
                id={`c-${r.slug}`}
                className="cm-row"
                tabIndex={onOpen && r.slug === rows[0]?.slug ? 0 : -1}
                {...(onOpen
                  ? {
                      onClick: () => onOpen(r.slug),
                      onKeyDown: (e: KeyboardEvent<HTMLTableRowElement>) => rowKeys(e, () => onOpen(r.slug)),
                      'aria-expanded': openSlug === r.slug ? true : undefined,
                    }
                  : {})}
                aria-haspopup="dialog"
                data-cm-row={r.slug}
                data-family={r.family}
                data-guidance={r.guidance}
                data-name={r.name.toLowerCase()}
              >
                <TableCell role="rowheader" className="cm-name">
                  <span className="cm-name-in">
                    <span className="cm-thumb" data-fit-frame="" aria-hidden="true" {...INERT}>
                      {r.preview && (
                        <span className="cm-thumb-fit" data-fit="">
                          <Thumb node={thumbnailNode(r.preview)!} />
                        </span>
                      )}
                    </span>
                    <span className="cm-name-body">
                      <span className="cm-name-text">{r.name}</span>
                      {exceptions(r).map((b) => (
                        <span key={b.label} className="cm-flag">
                        {b.agent && <Avatar kind="agent" brand="claude" size="xs" decorative />}
                        <Badge tone={b.tone} size="sm" className="cm-pill">
                          {b.short ? (
                            <>
                              <span className="cm-pill-full">{b.label}</span>
                              <span className="cm-pill-short">{b.short}</span>
                            </>
                          ) : (
                            b.label
                          )}
                        </Badge>
                        </span>
                      ))}
                    </span>
                  </span>
                </TableCell>
                {withUsage && (
                  <TableCell className="cm-col-used">
                    <span className="cm-used-tags">
                      {usedInCell(r.usedIn).map((p) => (
                        <Tag key={p} size="sm">{p}</Tag>
                      ))}
                    </span>
                  </TableCell>
                )}
                <TableCell className="cm-col-dev cm-muted">{words(r.examples, 'example')}</TableCell>
                <TableCell className="cm-col-dev cm-muted">{words(r.tokensTotal, 'token')}</TableCell>
                {withFigma && (
                  <TableCell className="cm-col-dev cm-muted" title={r.figma?.title}>
                    {r.figma?.label}
                  </TableCell>
                )}
              </TableRow>
            ))}
        </TableBody>
      ))}
    </Table>
  );
}
