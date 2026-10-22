// A team's Library, Tokens (multi-team PR 4a): every token of the team in one table, semantic first, primitives last.
// One sentence on what to use, search and tier on one row, then the table: token path and description, its value
// per theme (with a swatch for colors), and its CSS variable. Long lists show the first rows and "Show all".
// Values reach inline styles only through safeSpecimenValue (swatch); every repo string is React text.
import { useMemo, useState } from 'react';
import { Button, Input, Select, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@bridge-ds/react';
import { LibraryPage, LibrarySourceNote, LibraryZone, usePageTeam } from './LibraryState';
import { filterTokenRows, libraryTokenRows, TIER_LABEL, tierCounts, TOKEN_PAGE, tokenFromQuery, type LibraryTier } from '../../../lib/library-view';
import type { TeamData } from '../../../scripts/team-data';
import '../../../styles/team-components.css';

const ALL = '__all__';
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function Ready({ data, refreshing, onRefresh }: { data: TeamData; refreshing: boolean; onRefresh: () => void }) {
  const rows = useMemo(() => libraryTokenRows(data.model), [data.model]);
  const tiers = useMemo(() => tierCounts(rows), [rows]);
  // A search result opens one token (?t=<path>): every tier, filtered to it. Otherwise semantic first: what product
  // code should use. The other tiers are one choice away. Ready renders in the browser only, after the team is read.
  const [asked] = useState(() => tokenFromQuery(location.search));
  const [tier, setTier] = useState<LibraryTier | ''>(!asked && tiers.some((t) => t.tier === 'semantic') ? 'semantic' : '');
  const [query, setQuery] = useState(asked);
  const [all, setAll] = useState(false);
  const shown = filterTokenRows(rows, query, tier);
  const visible = all ? shown : shown.slice(0, TOKEN_PAGE);
  return (
    <>
      <div className="tcm-tools" role="search">
        <Input label="Search tokens" hideLabel placeholder="Search by name, CSS variable or value" value={query} onValueChange={setQuery} />
        <Select
          label="Tier"
          hideLabel
          value={tier || ALL}
          onValueChange={(v) => setTier(!v || v === ALL ? '' : (v as LibraryTier))}
          options={[{ value: ALL, label: `Every tier (${rows.length})` }, ...tiers.map((t) => ({ value: t.tier, label: `${TIER_LABEL[t.tier]} (${t.n})` }))]}
        />
      </div>
      <p className="ltm-muted" role="status" aria-live="polite">
        {shown.length === 0 ? 'No token matches.' : visible.length < shown.length ? `Showing ${visible.length} of ${plural(shown.length, 'token')}.` : `Showing ${plural(shown.length, 'token')}.`}
      </p>
      {visible.length > 0 && (
        <Table aria-label="Tokens" narrowLayout="stack" layout="fixed" className="ltm-tokens">
          <TableHeader>
            <TableRow>
              <TableHead width={0.42}>Token</TableHead>
              <TableHead>Value</TableHead>
              <TableHead width={0.28}>CSS variable</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((r) => (
              <TableRow key={`${r.tier}:${r.path}`}>
                <TableCell>
                  <span className="ltm-token">
                    <span className="mono ltm-token-path">{r.path}</span>
                    {r.deprecated && <span className="ltm-muted"> (deprecated)</span>}
                  </span>
                  {r.description && <span className="ltm-token-desc">{r.description}</span>}
                </TableCell>
                <TableCell>
                  <ul className="ltm-values">
                    {r.values.map((v) => (
                      <li key={v.label} className="ltm-value">
                        {v.swatch && <span className="ltm-swatch" style={{ background: v.swatch }} aria-hidden="true" />}
                        {r.values.length > 1 && <span className="ltm-value-label">{v.label}</span>}
                        <span className="mono ltm-value-text">{v.text}</span>
                      </li>
                    ))}
                  </ul>
                </TableCell>
                <TableCell>
                  <span className="mono ltm-var">{r.cssVar}</span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {visible.length < shown.length && (
        <Button variant="secondary" onClick={() => setAll(true)} className="ltm-more">
          Show all {shown.length}
        </Button>
      )}
      <LibrarySourceNote data={data} refreshing={refreshing} onRefresh={onRefresh} />
    </>
  );
}

export default function LibraryTokens() {
  const team = usePageTeam();
  return (
    <LibraryPage
      label="Reading the tokens"
      header={(data) => (
        <LibraryZone
          title="Tokens"
          art="tokens"
          lead={
            data
              ? `${plural(data.model.tokens.rows.all.length + data.model.tokens.rows.primitives.length, 'token')} of ${data.owner}/${data.repo}. Use the semantic tokens in product code: they follow the theme. Primitives are the raw palette underneath.`
              : `Every token of ${team ? `${team.owner}/${team.repo}` : 'this design system'}, with its value per theme.`
          }
        />
      )}
      ready={(data, r) => <Ready data={data} {...r} />}
    />
  );
}
