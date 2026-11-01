// The developers' task Done exploring opened from the design team's copy: one read of the issue, and its timeline while
// it is open (the developers' pull request that links it, for the Review step).
import { designReviewComment, designReviewOf, devPullOfTimeline, type DesignAnswer, type DesignTaskRead, type DevPull, type TimelineEventLike } from '../lib/review-state';
import { ghGet, ghWrite } from './github-session';

const TASK_URL = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/(\d+)$/;

/** The repository and number of a task URL, or null. */
export function taskRef(url: string): { repo: string; number: number } | null {
  const m = TASK_URL.exec(url.trim());
  return m ? { repo: m[1]!, number: Number(m[2]) } : null;
}

/**
 * A design copy exploration's task in the developers' repository (its issue URL): null when it cannot be read. Its
 * timeline is read at the same time (one more call, bounded to the first page): an open pull request of the
 * developers that links it is the Review step. A timeline GitHub refuses leaves the task as it is.
 */
export async function readDesignTask(url: string): Promise<DesignTaskRead | null> {
  const ref = taskRef(url);
  if (!ref) return null;
  try {
    const [issue, timeline] = await Promise.all([
      ghGet<{ assignees?: { login: string }[] | null; state: string; state_reason?: string | null; closed_at?: string | null }>(`/repos/${ref.repo}/issues/${ref.number}`),
      ghGet<TimelineEventLike[]>(`/repos/${ref.repo}/issues/${ref.number}/timeline?per_page=100`).catch(() => null),
    ]);
    const i = issue.data;
    const devPull = i.state === 'open' && timeline ? devPullOfTimeline(timeline.data ?? [], ref.repo) : null;
    return { assignees: i.assignees ?? [], state: i.state, stateReason: i.state_reason ?? null, closedAt: i.closed_at ?? null, devPull };
  } catch {
    return null;
  }
}

/** The developers' pull request with its branch and the last design review Bridge posted on it (two reads at once). */
export async function readDevPull(repo: string, pull: DevPull): Promise<{ pull: DevPull; answer: ReturnType<typeof designReviewOf> }> {
  const [p, comments] = await Promise.all([
    ghGet<{ head?: { ref?: string } | null; draft?: boolean }>(`/repos/${repo}/pulls/${pull.number}`).catch(() => null),
    ghGet<{ body?: string | null; user?: { login?: string } | null; created_at?: string }[]>(`/repos/${repo}/issues/${pull.number}/comments?per_page=100`).catch(() => null),
  ]);
  return {
    pull: { ...pull, headRef: p?.data.head?.ref ?? null, ...(p?.data.draft !== undefined ? { draft: p.data.draft } : {}) },
    answer: comments ? designReviewOf(comments.data ?? []) : null,
  };
}

/** Posts the designer's answer on the developers' pull request, with the signed-in viewer's GitHub session. */
export async function answerDevPull(repo: string, number: number, answer: DesignAnswer): Promise<void> {
  await ghWrite('POST', `/repos/${repo}/issues/${number}/comments`, { body: designReviewComment(answer) });
}
