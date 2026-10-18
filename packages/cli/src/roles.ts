// bridge check: who holds each role when governance.owners names GitHub teams ("@acme/design"). Teams are read from
// GitHub (the token needs read:org); a team that cannot be read is reported with the reason and the fix. Read only,
// and never part of the exit code, like the protection line: CI tokens often cannot read organization teams.
import {
  type FetchLike,
  GitHubClient,
  type Owners,
  TeamDirectory,
  type TeamState,
  entryLabel,
  teamsIn,
} from '@bridge-ds/core';

export interface RolesReport {
  /** Each team named in the owner lists, read or not. Empty when only people are listed. */
  teams: TeamState[];
  lines: string[];
}

/** The roles line(s). Nothing when no team is named (no request). Never throws. */
export async function rolesReport(opts: { repo: string; owners: Owners; token?: string | undefined; fetch?: FetchLike | undefined }): Promise<RolesReport> {
  if (!teamsIn(opts.owners).length) return { teams: [], lines: [] };
  const client = new GitHubClient(opts.repo, opts.token ?? '', opts.fetch, { attempts: 1, baseDelayMs: 0, sleep: async () => {} });
  const states = await new TeamDirectory(client).resolve(opts.owners);
  const teams = Object.values(states);
  const group = (entries: string[]) => (entries.length ? entries.map((e) => entryLabel(e, states)).join(', ') : 'nobody listed');
  const lines = [`roles: design owners ${group(opts.owners.design)}; tech owners ${group(opts.owners.tech)}`];
  for (const t of teams) if (t.status === 'unreadable') lines.push(`  warn   team-unreadable  ${t.message}`);
  return { teams, lines };
}
