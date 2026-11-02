// The load test's results as the Markdown table of docs/QUOTA-LOADTEST.md.
import type { Result } from './sim';

/** GitHub's primary limit for a GitHub App installation (GitHub docs, assumptions of the report). */
export const INSTALLATION_LIMITS = { baseline: 5000, scaledMax: 12500, enterpriseCloud: 15000 } as const;

const pct = (x: number) => `${(x * 100).toFixed(1)} %`;
const share = (n: number, of: number) => `${((n / of) * 100).toFixed(1)} %`;

/** A burst runs minutes, not an hour: its hourly rate would mislead. */
const perHour = (r: Result) => (r.name.startsWith('D') ? 'n/a (burst)' : String(r.countedPerHour));

const md = (head: string[], rows: string[][]) => {
  const line = (cells: string[]) => `| ${cells.join(' | ')} |`;
  return [line(head), line(head.map(() => '---')), ...rows.map(line)].join('\n');
};

/** GitHub's side: what the installation is charged. */
export function table(rs: Result[]): string {
  return md(
    ['Scenario', 'People', 'Page loads', 'Reads at Bridge', 'Counted calls', 'Counted / h', 'Of 5,000 / h', 'Free 304s', 'Peak / min', 'Peak in flight', 'Cache hit ratio'],
    rs.map((r) => [`${r.name}: ${r.label}`, String(r.people), String(r.pageLoads), String(r.reads), String(r.counted), perHour(r), r.name.startsWith('D') ? 'n/a' : share(r.countedPerHour, INSTALLATION_LIMITS.baseline), String(r.free), String(r.peakPerMinute), String(r.peakInFlight), pct(r.hitRatio)]),
  );
}

/** Bridge's side: its own limits and what readers see. */
export function limits(rs: Result[]): string {
  return md(
    ['Scenario', 'Reader cap hits (readers)', 'Team budget hits', 'Member budget hits', 'Busy answers (readers)', 'Changes left out', 'Peak member weight / 10 min', 'Peak team weight / 10 min', 'Counted but unchanged', 'Concurrent duplicate misses'],
    rs.map((r) => [r.name, `${r.capHits} (${r.readersAtCap})`, String(r.teamBudgetHits), String(r.memberBudgetHits), `${r.busyAnswers} (${r.readersBusy})`, String(r.changesLeftOut), String(r.peakMemberWeight), String(r.peakTeamWeight), String(r.unchanged), String(r.overlapping)]),
  );
}

/** Counted calls by kind of read, one line per scenario. */
export function kinds(rs: Result[]): string {
  return rs
    .map((r) => `- ${r.name}: ${Object.entries(r.byKind).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ')}; answers by source: ${Object.entries(r.bySource).map(([k, n]) => `${k} ${n}`).join(', ')}`)
    .join('\n');
}
