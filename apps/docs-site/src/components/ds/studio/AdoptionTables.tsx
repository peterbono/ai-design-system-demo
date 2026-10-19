// Studio Adoption: the static tables of an audit report (top files, top fixes, trend), as DS Tables.
// The Adoption page formats every value; these only lay them out. Row headers use role="rowheader". On a phone each
// row stacks as a card (narrowLayout="stack"), every value beside its column name: label on each cell, since the page
// is static and the Table cannot copy the header text without JavaScript.
import { Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, type BadgeTone } from '@bridge-ds/react';
import type { CategoryRow } from '../../../lib/audits';

const share = (n: number, max: number) => `${max ? (n / max) * 100 : 0}%`;

/** Hard-coded values per category: a share bar (exact, near and no token) and the counts. */
export function HardcodedCategoriesTable({ rows }: { rows: CategoryRow[] }) {
  const max = Math.max(1, ...rows.map((c) => c.hardcoded));
  return (
    <Table narrowLayout="stack" aria-label="Hard-coded values per category, split by how well a token matches">
      <TableHeader>
        <TableRow>
          <TableHead>Category</TableHead>
          <TableHead width={0.4} minWidth="calc(var(--size-64) / 2)">
            Share
          </TableHead>
          <TableHead numeric>Values</TableHead>
          <TableHead numeric>Exact</TableHead>
          <TableHead numeric>Near</TableHead>
          <TableHead numeric>None</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((c) => (
          <TableRow key={c.key}>
            <TableCell role="rowheader" label="">
              {c.label}
            </TableCell>
            <TableCell label="Share">
              <span className="ad-track" style={{ width: share(c.hardcoded, max) }}>
                {c.exact > 0 && <span className="ad-seg ad-exact" style={{ width: share(c.exact, c.hardcoded) }} />}
                {c.near > 0 && <span className="ad-seg ad-near" style={{ width: share(c.near, c.hardcoded) }} />}
                {c.none > 0 && <span className="ad-seg ad-none" style={{ width: share(c.none, c.hardcoded) }} />}
              </span>
            </TableCell>
            <TableCell numeric label="Values">
              {c.hardcoded}
            </TableCell>
            <TableCell numeric label="Exact">
              {c.exact}
            </TableCell>
            <TableCell numeric label="Near">
              {c.near}
            </TableCell>
            <TableCell numeric label="None">
              {c.none}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export interface TopFileRow {
  path: string;
  hardcoded: number;
  otherComponents: number;
  tokenUsages: number;
  dsComponents: number;
}

export function TopFilesTable({ rows }: { rows: TopFileRow[] }) {
  return (
    <Table narrowLayout="stack" aria-label="Files with the most hardcoded values">
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
            <TableCell role="rowheader" label="" className="ad-path">
              <code>{f.path}</code>
            </TableCell>
            <TableCell numeric label="Hardcoded">
              {f.hardcoded}
            </TableCell>
            <TableCell numeric label="Non-DS components">
              {f.otherComponents}
            </TableCell>
            <TableCell numeric label="Token usages">
              {f.tokenUsages}
            </TableCell>
            <TableCell numeric label="DS components">
              {f.dsComponents}
            </TableCell>
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
    <Table narrowLayout="stack" aria-label="Most repeated literals and the token that replaces them">
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
            <TableCell role="rowheader" label="">
              <code>{f.value}</code> <span className="muted small">{f.category}</span>
            </TableCell>
            <TableCell label="Token">
              {f.suggestion ? (
                <span>
                  <code>{`var(${f.suggestion.cssVar})`}</code> <span className="muted small">{f.suggestion.value}</span>
                </span>
              ) : (
                <span className="muted">No token fits</span>
              )}
            </TableCell>
            <TableCell label="Confidence">
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
            <TableCell numeric label="Uses">
              {f.count}
            </TableCell>
            <TableCell numeric label="Files">
              {f.files}
            </TableCell>
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
    <Table narrowLayout="stack" aria-label="Adoption per run">
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
            <TableCell role="rowheader" label="">
              {p.label} <span className="muted small">{p.date}</span>
            </TableCell>
            <TableCell numeric label="Token adoption">
              {p.tokenAdoption}
            </TableCell>
            <TableCell numeric label="Component adoption">
              {p.componentAdoption}
            </TableCell>
            <TableCell numeric label="Hardcoded">
              {p.hardcoded}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
