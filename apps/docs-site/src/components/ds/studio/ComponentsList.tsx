// Studio Components: every component in one DS Table, grouped by family under small row-group headers. Each row
// starts with a calm thumbnail of the real component (one sample of its Library preview, never a destructive one:
// lib/components-studio thumbnailNode; rendered at build time and scaled to fit by scripts/components-studio.ts; a
// component without a preview shows an empty frame, never a stand-in image), then what a designer reads, in words:
// the products that use it as tags (from the committed `bridge audit` reports), open requests (filled in the browser from
// the requests Studio already reads), examples and tokens. Badges only for exceptions (missing guidance, a Claude
// draft to review, beta, deprecated). The whole row opens the detail drawer: rows are one tab stop with arrow keys
// between them, Enter opens.
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Tag } from '@bridge-ds/react';
import type { ExampleNode, GuidanceState } from '../../../lib/components';
import { thumbnailNode, usedInCell } from '../../../lib/components-studio';
import Example from '../../Example';

export interface ComponentListRow {
  slug: string;
  name: string;
  family: string;
  status: 'stable' | 'beta' | 'deprecated';
  guidance: GuidanceState;
  /** Tokens it paints with, own and inherited (where they come from is in the drawer's For developers). */
  tokensTotal: number;
  /** Storybook stories, shown to designers as examples. */
  examples: number;
  /** The Library preview (docs.json "preview"), rendered as the thumbnail. */
  preview?: ExampleNode | undefined;
  /** Products that use it, from the audit reports; undefined when no report exists (the column is left out). */
  usedIn?: { product: string; instances: number }[] | undefined;
}

/** The exception badges of a row, in the Studio status colors: violet waits for someone, grey for the rest. */
export function exceptions(r: Pick<ComponentListRow, 'guidance' | 'status'>): { label: string; tone: string; short?: string }[] {
  const out: { label: string; tone: string; short?: string }[] = [];
  if (r.guidance === 'missing') out.push({ label: 'Missing guidance', tone: '', short: 'No guidance' });
  if (r.guidance === 'review') out.push({ label: 'Draft by Claude, needs review', tone: 'is-info', short: 'Needs review' });
  if (r.status === 'beta') out.push({ label: 'Beta', tone: '' });
  if (r.status === 'deprecated') out.push({ label: 'Deprecated', tone: '' });
  return out;
}

/** Thumbnails show; they never take focus or clicks (React 18 has no typed `inert` prop). */
const INERT = { inert: '' } as Record<string, string>;

const words = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

export default function ComponentsList({ rows, products }: { rows: ComponentListRow[]; products: number }) {
  const families = [...new Set(rows.map((r) => r.family))];
  const withUsage = products > 0;
  const cols = withUsage ? 5 : 4;
  return (
    <Table aria-label="Components by family. Arrow keys move between rows, Enter opens one." className="cm-table" data-cm-table="">
      <TableHeader>
        <TableRow>
          <TableHead>Component</TableHead>
          {withUsage && <TableHead className="cm-col-used">Used in</TableHead>}
          <TableHead className="cm-col-req">Open requests</TableHead>
          <TableHead className="cm-col-dev">Examples</TableHead>
          <TableHead className="cm-col-dev">Tokens</TableHead>
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
                tabIndex={-1}
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
                          <Example node={thumbnailNode(r.preview)!} />
                        </span>
                      )}
                    </span>
                    <span className="cm-name-body">
                      <span className="cm-name-text">{r.name}</span>
                      {exceptions(r).map((b) => (
                        <span key={b.label} className={`pill cm-pill ${b.tone}`}>
                          {b.short ? (
                            <>
                              <span className="cm-pill-full">{b.label}</span>
                              <span className="cm-pill-short">{b.short}</span>
                            </>
                          ) : (
                            b.label
                          )}
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
                {/* Filled in the browser: "1 request", empty when there is none. */}
                <TableCell className="cm-col-req" data-cm-req-n={r.name.toLowerCase()} />
                <TableCell className="cm-col-dev cm-muted">{words(r.examples, 'example')}</TableCell>
                <TableCell className="cm-col-dev cm-muted">{words(r.tokensTotal, 'token')}</TableCell>
              </TableRow>
            ))}
        </TableBody>
      ))}
    </Table>
  );
}
