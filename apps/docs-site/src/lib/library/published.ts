// Where a team's Library was read from: the files `bridge snapshot` publishes on its bridge-data branch (llms.txt next
// to snapshot.json) and the line that dates a snapshot read as published. Pure, browser-safe.
import { SNAPSHOT_BRANCH, SNAPSHOT_LLMS_FILE } from '@bridge-ds/core';

const gh = (s: string) => encodeURIComponent(s);

/** A file on the team's bridge-data branch: the raw file for a public repository, the GitHub page for a private one
 * (the raw host answers 404 to anyone without access, and a signed-in reader's browser has no cookie there). */
export function bridgeDataUrl(owner: string, repo: string, file: string, isPrivate: boolean): string {
  return isPrivate ? `https://github.com/${gh(owner)}/${gh(repo)}/blob/${SNAPSHOT_BRANCH}/${file}` : `https://raw.githubusercontent.com/${gh(owner)}/${gh(repo)}/${SNAPSHOT_BRANCH}/${file}`;
}

/** The team's llms.txt, published next to its snapshot by `bridge snapshot`. */
export const llmsTxtUrl = (owner: string, repo: string, isPrivate: boolean) => bridgeDataUrl(owner, repo, SNAPSHOT_LLMS_FILE, isPrivate);

/** "Published Oct 20, 2026 from a1b2c3d on main." for a snapshot read as published, else null. */
export function publishedLine(input: { published?: string | undefined; sha: string; branch: string }): string | null {
  if (!input.published) return null;
  const d = new Date(input.published);
  if (Number.isNaN(d.getTime())) return null;
  const date = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(d);
  return `Published ${date} from ${input.sha.slice(0, 7)} on ${input.branch}.`;
}
