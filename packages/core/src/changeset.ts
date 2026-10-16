// Changeset writer for token changes (.changeset/*.md, read by @changesets/cli).

import type { AcceptedChange } from './compose';
import { changeKind } from './pr-composer';

/** Semver bump per .changeset/README.md: removals and renames are breaking, the rest is minor. */
export function changesetBump(changes: AcceptedChange[]): 'minor' | 'major' {
  return changes.some((c) => ['removed', 'renamed'].includes(changeKind(c))) ? 'major' : 'minor';
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
    content: `---\n"${opts.packageName}": ${bump}\n---\n\n${summary}\n\n${list}${more}\n`,
  };
}
