// Studio Components: every component in one DS Table, grouped by family under small row-group headers. Three
// columns (name, tokens, stories); badges only for exceptions (missing guidance, a Claude draft to review, beta,
// deprecated). The whole row opens the detail drawer (scripts/components-studio.ts): rows are one tab stop with
// arrow keys between them, Enter opens.
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@bridge-ds/react';
import type { GuidanceState } from '../../../lib/components';

export interface ComponentListRow {
  slug: string;
  name: string;
  family: string;
  status: 'stable' | 'beta' | 'deprecated';
  guidance: GuidanceState;
  /** "1 own · 39 from Button", or the count. */
  tokens: string;
  tokensTotal: number;
  stories: number;
}

/** The exception badges of a row, in the Studio status colors: violet waits for someone, grey for the rest. */
export function exceptions(r: Pick<ComponentListRow, 'guidance' | 'status'>): { label: string; tone: string }[] {
  const out: { label: string; tone: string }[] = [];
  if (r.guidance === 'missing') out.push({ label: 'Missing guidance', tone: '' });
  if (r.guidance === 'review') out.push({ label: 'Draft by Claude, needs review', tone: 'is-info' });
  if (r.status === 'beta') out.push({ label: 'Beta', tone: '' });
  if (r.status === 'deprecated') out.push({ label: 'Deprecated', tone: '' });
  return out;
}

export default function ComponentsList({ rows }: { rows: ComponentListRow[] }) {
  const families = [...new Set(rows.map((r) => r.family))];
  return (
    <Table aria-label="Components by family. Arrow keys move between rows, Enter opens one." className="cm-table">
      <TableHeader>
        <TableRow>
          <TableHead>Component</TableHead>
          <TableHead numeric>Tokens</TableHead>
          <TableHead numeric>Stories</TableHead>
        </TableRow>
      </TableHeader>
      {families.map((family) => (
        <TableBody key={family} data-cm-family={family}>
          <TableRow className="cm-fam">
            <TableHead scope="rowgroup" colSpan={3}>
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
                  <span className="cm-name-text">{r.name}</span>
                  {exceptions(r).map((b) => (
                    <span key={b.label} className={`pill cm-pill ${b.tone}`}>
                      {b.label}
                    </span>
                  ))}
                </TableCell>
                <TableCell numeric className="cm-tokens">
                  {r.tokens}
                </TableCell>
                <TableCell numeric>{r.stories}</TableCell>
              </TableRow>
            ))}
        </TableBody>
      ))}
    </Table>
  );
}
