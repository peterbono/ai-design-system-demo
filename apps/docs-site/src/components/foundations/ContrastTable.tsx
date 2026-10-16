// The "All pairs" grid of the Accessibility page, built with the DS Table. A .tsx component (not markup in the
// .astro page) because Astro wraps the children of a React component in an <astro-static-slot> element, which is not
// valid inside <table>: the table parts have to be rendered by React together. Rendered statically, no client JS.
import { Badge, Link, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Tag } from '@bridge-ds/react';
import { CircleAlert, CircleCheck } from 'lucide-react';

export interface ContrastCombo {
  key: string;
  brand: string;
  mode: 'light' | 'dark';
  label: string;
}

export interface ContrastResult {
  ratio: number;
  fgHex: string;
  bgHex: string;
  aa: boolean;
  aaa: boolean | null;
}

export interface ContrastRow {
  fg: string;
  bg: string;
  fgHref: string;
  bgHref: string;
  fgVar: string;
  bgVar: string;
  usage: 'text' | 'ui';
  min: number;
  /** One result per combo, in the order of `combos`. */
  results: ContrastResult[];
}

export default function ContrastTable({ combos, rows }: { combos: ContrastCombo[]; rows: ContrastRow[] }) {
  return (
    <Table aria-label="Contrast ratio per token pair, brand and theme" className="ds-ct-table">
      <TableHeader>
        <TableRow>
          <TableHead>Foreground on background</TableHead>
          <TableHead>Use</TableHead>
          {combos.map((c) => (
            <TableHead key={c.key}>{c.label}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((p) => (
          <TableRow key={`${p.fg}|${p.bg}`}>
            <TableHead scope="row">
              <Link href={p.fgHref}>{p.fg}</Link>
              <br />
              <span className="muted small">on</span> <Link href={p.bgHref}>{p.bg}</Link>
            </TableHead>
            <TableCell>
              <Tag size="sm">{p.usage === 'text' ? 'Text' : 'UI'}</Tag> <span className="muted small num">min {p.min}:1</span>
            </TableCell>
            {combos.map((c, i) => {
              const r = p.results[i]!;
              return (
                <TableCell key={c.key}>
                  <div className="ct-cell">
                    <div className="ct-tile" data-theme={c.mode} data-brand={c.brand} data-scope-fixed="" style={{ backgroundColor: `var(${p.bgVar})` }}>
                      {p.usage === 'text' ? <span style={{ color: `var(${p.fgVar})` }}>Aa</span> : <i style={{ borderColor: `var(${p.fgVar})` }} />}
                    </div>
                    <div className="ct-cell-meta">
                      <strong className="num">{r.ratio.toFixed(2)}:1</strong>
                      <span className="chain">
                        {r.fgHex} / {r.bgHex}
                      </span>
                      <span className="ct-pills">
                        <Badge tone={r.aa ? 'success' : 'danger'} icon={r.aa ? CircleCheck : CircleAlert} size="sm">
                          {r.aa ? 'AA pass' : 'AA fail'}
                        </Badge>
                        {r.aaa !== null && (
                          <Badge tone={r.aaa ? 'success' : 'neutral'} icon={r.aaa ? CircleCheck : undefined} size="sm">
                            {r.aaa ? 'AAA pass' : 'Not AAA'}
                          </Badge>
                        )}
                      </span>
                    </div>
                  </div>
                </TableCell>
              );
            })}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
