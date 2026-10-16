// Changeset writer for token changes (.changeset/*.md, read by @changesets/cli).

import type { AcceptedChange } from './compose';
import { changeKind } from './pr-composer';
import { type SemverBump, tokenBump } from './risk';

/**
 * Semver bump per .changeset/README.md, from the shared risk rules: removals and renames are breaking,
 * other value changes minor, description-only changes patch.
 */
export function changesetBump(changes: AcceptedChange[]): SemverBump {
  return tokenBump(changes) ?? 'patch';
}

/** Text of a changeset file bumping one package. */
export function formatChangeset(packageName: string, bump: SemverBump, summary: string, details = ''): string {
  return `---\n"${packageName}": ${bump}\n---\n\n${summary.trim()}\n${details ? `\n${details.trim()}\n` : ''}`;
}

export interface ChangesetOptions {
  /** Summary line (usually the PR title). */
  title: string;
  /** Branch name; the file name is derived from it. */
  branch: string;
  /** Package to bump, from bridge.config.json "changeset.package". */
  packageName: string;
  /** Appended to the summary, for example "from Figma via DS Bridge". */
  source?: string;
}

/** A changeset file for a token change: `{ path: ".changeset/<name>.md", content }`. */
export function composeChangeset(changes: AcceptedChange[], opts: ChangesetOptions): { path: string; content: string } {
  const bump = changesetBump(changes);
  const name = opts.branch.replace(/^tokens\//, 'ds-bridge-').replace(/[^a-z0-9-]/gi, '-');
  const list = changes
    .slice(0, 20)
    .map((c) => `- ${changeKind(c)} \`${(c.target ?? c.current)!.path}\``)
    .join('\n');
  const more = changes.length > 20 ? `\n- and ${changes.length - 20} more` : '';
  const summary = opts.source ? `${opts.title} (${opts.source}).` : `${opts.title}.`;
  return {
    path: `.changeset/${name}.md`,
    content: formatChangeset(opts.packageName, bump, summary, `${list}${more}`),
  };
}
