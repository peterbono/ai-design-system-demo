// Studio Adoption: the static tables of an audit report (top files, top fixes, trend), as DS Tables.
// The Adoption page formats every value; these only lay them out. Row headers use role="rowheader".
import { Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, type BadgeTone } from '@bridge-ds/react';

export interface TopFileRow {
  path: string;
  hardcoded: number;
  otherComponents: number;
  tokenUsages: number;
  dsComponents: number;
}

export function TopFilesTable({ rows }: { rows: TopFileRow[] }) {
  return (
    <Table aria-label="Files with the most hardcoded values">
      <TableHeader>
        <TableRow>
          <TableHead>File</TableHead>
          <TableHead numeric>Hardcoded</TableHead>
          <TableHead numeric>Non-DS components</TableHead>
          <TableHead numeric>Token usages</TableHead>
          <TableHead numeric>DS components</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((f) => (
          <TableRow key={f.path}>
            <TableCell role="rowheader" className="ad-path">
              <code>{f.path}</code>
            </TableCell>
            <TableCell numeric>{f.hardcoded}</TableCell>
            <TableCell numeric>{f.otherComponents}</TableCell>
            <TableCell numeric>{f.tokenUsages}</TableCell>
            <TableCell numeric>{f.dsComponents}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export interface TopFixRow {
  value: string;
  category: string;
  suggestion?: { cssVar: string; value: string; level: string } | null;
  count: number;
  files: number;
}

const LEVEL_TONE: Record<string, BadgeTone> = { exact: 'success', high: 'info', medium: 'warning' };

export function TopFixesTable({ rows }: { rows: TopFixRow[] }) {
  return (
    <Table aria-label="Most repeated literals and the token that replaces them">
      <TableHeader>
        <TableRow>
          <TableHead>Value</TableHead>
          <TableHead>Token</TableHead>
          <TableHead>Confidence</TableHead>
          <TableHead numeric>Uses</TableHead>
          <TableHead numeric>Files</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((f, i) => (
          <TableRow key={`${f.value}-${i}`}>
            <TableCell role="rowheader">
              <code>{f.value}</code> <span className="muted small">{f.category}</span>
            </TableCell>
            <TableCell>
              {f.suggestion ? (
                <span>
                  <code>{`var(${f.suggestion.cssVar})`}</code> <span className="muted small">{f.suggestion.value}</span>
                </span>
              ) : (
                <span className="muted">No token fits</span>
              )}
            </TableCell>
            <TableCell>
              {f.suggestion ? (
                <Badge size="sm" tone={LEVEL_TONE[f.suggestion.level] ?? 'neutral'}>
                  {f.suggestion.level}
                </Badge>
              ) : (
                <Badge size="sm" tone="danger">
                  missing
                </Badge>
              )}
            </TableCell>
            <TableCell numeric>{f.count}</TableCell>
            <TableCell numeric>{f.files}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export interface TrendRow {
  label: string;
  date: string;
  tokenAdoption: string;
  componentAdoption: string;
  hardcoded: number;
}

export function TrendTable({ rows }: { rows: TrendRow[] }) {
  return (
    <Table aria-label="Adoption per run">
      <TableHeader>
        <TableRow>
          <TableHead>Run</TableHead>
          <TableHead numeric>Token adoption</TableHead>
          <TableHead numeric>Component adoption</TableHead>
          <TableHead numeric>Hardcoded</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((p, i) => (
          <TableRow key={i}>
            <TableCell role="rowheader">
              {p.label} <span className="muted small">{p.date}</span>
            </TableCell>
            <TableCell numeric>{p.tokenAdoption}</TableCell>
            <TableCell numeric>{p.componentAdoption}</TableCell>
            <TableCell numeric>{p.hardcoded}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
