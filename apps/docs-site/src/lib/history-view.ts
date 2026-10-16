// Pure shaping of history data for the History page and the token panel. No DOM, no fetch: runs at build time
// (demo diffs) and in the browser. Unit tested in history-view.test.ts.
import {
  LayeredTokenSet,
  applyTokenEdits,
  filterHistory,
  versionTimeline,
  type BridgeConfig,
  type HistoryCounts,
  type HistoryEntry,
  type HistoryFilter,
  type HistoryReport,
  type TokenEdit,
  type VersionGroup,
} from '@bridge/core';

/** Token files before an entry, from the files right after it: every change of the entry undone. */
export function demoBeforeFiles(config: BridgeConfig, after: Record<string, string>, entry: HistoryEntry): Record<string, string> {
  const edits: TokenEdit[] = [];
  for (const c of entry.changes) {
    if (c.kind === 'changed') {
      edits.push({
        op: 'set',
        path: c.path,
        file: c.file,
        ...(c.fields.includes('value') ? { value: c.before } : {}),
        ...(c.fields.includes('description') ? { description: c.descriptionBefore ?? '' } : {}),
      });
    } else if (c.kind === 'added') edits.push({ op: 'remove', path: c.path, file: c.file });
    else if (c.kind === 'removed') edits.push({ op: 'add', path: c.path, file: c.file, value: c.before, ...(c.type ? { type: c.type } : {}) });
    else if (c.kind === 'renamed' && c.from && !edits.some((e) => e.op === 'rename' && e.path === c.path)) edits.push({ op: 'rename', path: c.path, newPath: c.from });
  }
  const usable = edits.filter((e) => e.value !== undefined || e.description !== undefined || e.op !== 'set');
  if (!usable.length) return after;
  return Object.fromEntries(applyTokenEdits(new LayeredTokenSet(config, new Map(Object.entries(after))), usable).files);
}

export interface ViewGroup extends VersionGroup {
  items: HistoryEntry[];
}

/** The version timeline restricted to the entries that pass the filter; empty versions are dropped. */
export function viewTimeline(report: HistoryReport, filter: HistoryFilter = {}): ViewGroup[] {
  const kept = filterHistory(report.entries, filter);
  const byId = new Map(kept.map((e) => [e.id, e]));
  return versionTimeline(kept, report.releases).map((g) => ({ ...g, items: g.entries.map((id) => byId.get(id)!).filter(Boolean) }));
}

export function authorsOf(entries: HistoryEntry[]): string[] {
  return [...new Set(entries.map((e) => e.author))].sort((a, b) => a.localeCompare(b));
}

/** "3 changed, 1 added", in the order designers scan them. */
export function countsLabel(c: HistoryCounts): string {
  const parts = (['changed', 'added', 'renamed', 'removed'] as const).filter((k) => c[k]).map((k) => `${c[k]} ${k}`);
  return parts.join(', ') || 'no token change';
}

/** Entries that landed after `entry`: they explain revert conflicts. */
export function laterThan(entries: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  return entries.filter((e) => e.id !== entry.id && Date.parse(e.date) >= Date.parse(entry.date));
}

/** What the real history amounts to, for the sparse state: reviewable entries vs imports. */
export function realSummary(report: HistoryReport | null): { total: number; reviewable: number; imports: number; tokenChanges: number } {
  const entries = report?.entries ?? [];
  const imports = entries.filter((e) => e.bulk).length;
  return { total: entries.length, reviewable: entries.length - imports, imports, tokenChanges: entries.reduce((n, e) => n + (e.bulk ? 0 : e.counts.total), 0) };
}

export const shortDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : d.toLocaleDateString('en', { year: 'numeric', month: 'short', day: 'numeric' });
};

/**
 * The core PR body assumes an agent proposed the change. From the docs a person does: tick "Human" instead and
 * say so in the provenance line.
 */
export function humanAuthored(body: string): string {
  return body
    .replace('- [ ] Human\n- [x] AI agent (Claude), reviewed by a human before merge', '- [x] Human\n- [ ] AI agent (Claude), reviewed by a human before merge')
    .replace(/Agent-authored: a human design owner and tech owner review and merge\./, 'Planned by a person in Bridge, no AI involved in the values. A design owner and a tech owner review and merge.');
}
