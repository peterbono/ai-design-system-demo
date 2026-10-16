// Status chip of an open pull request, read live from GitHub: CI (check runs + commit statuses) and reviews, then
// reviewStatus() from lib/review-rules. Shared by the Studio Overview ("Needs you") and the Reviews list.
// Reads go through ghGet, so they are cached in this browser and survive a rate limit.
import { esc, ghGet, readRepo } from './github-session';
import {
  parseTier,
  reviewStatus,
  summarizeApprovals,
  summarizeCi,
  type CheckRunLike,
  type LabelLike,
  type ReviewLike,
  type ReviewStatus,
  type StatusLike,
} from '../lib/review-rules';

export interface PullForStatus {
  number: number;
  state?: string;
  draft?: boolean;
  merged_at?: string | null;
  body?: string | null;
  labels?: LabelLike[];
  user: { login: string };
  head: { sha: string; ref: string };
}

function owners(): { design: string[]; tech: string[] } {
  try {
    const site = JSON.parse(document.getElementById('bridge-repo')?.textContent || '{}') as { owners?: { design: string[]; tech: string[] } };
    return site.owners ?? { design: [], tech: [] };
  } catch {
    return { design: [], tech: [] };
  }
}

/** CI summary of a commit: check runs plus the combined commit status. */
export async function ciFor(sha: string) {
  const { owner, repo } = readRepo();
  const R = `/repos/${owner}/${repo}`;
  const [runs, statuses] = await Promise.all([
    ghGet<{ check_runs: CheckRunLike[] }>(`${R}/commits/${sha}/check-runs?per_page=100`),
    ghGet<{ statuses: StatusLike[] }>(`${R}/commits/${sha}/status`).catch(() => ({ data: { statuses: [] as StatusLike[] }, stale: false })),
  ]);
  return summarizeCi(runs.data.check_runs, statuses.data.statuses);
}

/** The status of one pull request. Never throws: a failed read gives "Status unknown", never "Ready to merge". */
export async function pullStatus(p: PullForStatus): Promise<ReviewStatus> {
  const { owner, repo } = readRepo();
  const [ci, reviews] = await Promise.all([
    ciFor(p.head.sha).catch(() => null),
    ghGet<ReviewLike[]>(`/repos/${owner}/${repo}/pulls/${p.number}/reviews?per_page=100`)
      .then((f) => f.data)
      .catch(() => null),
  ]);
  return reviewStatus({
    state: p.state,
    draft: p.draft,
    merged_at: p.merged_at,
    ci,
    approvals: reviews ? summarizeApprovals(reviews, owners(), p.user.login) : null,
    tier: parseTier(p.labels ?? [], p.body),
  });
}

/** Pill markup of a status. `loading` shows a neutral placeholder while the reads run. */
export function statusChip(s: ReviewStatus | null): string {
  if (!s) return '<span class="pill rv-status is-loading" aria-label="Checking status">Checking</span>';
  return `<span class="pill rv-status ${s.tone}" data-status="${esc(s.kind)}">${esc(s.label)}</span>`;
}
