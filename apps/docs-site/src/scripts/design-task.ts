// The developers' task Done exploring opened from the design team's copy: one read of the issue, and its timeline while
// it is open (the developers' pull request that links it, for the Review step).
import { designReviewComment, designReviewOf, devPullOfTimeline, taskStage, type LifecycleStage, type DesignAnswer, type DesignTaskRead, type DevPull, type TimelineEventLike } from '../lib/review-state';
import { isCloudflareCheck, parseCloudflareCheck, parseExplorationBody } from '@bridge-ds/core';
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
    const found = i.state === 'open' && timeline ? devPullOfTimeline(timeline.data ?? [], ref.repo) : null;
    // Their pull request's comments: the designer's last answer, for the lists' Review line. One more read, only then.
    const devPull = found ? { ...found, answer: await lastAnswerOn(ref.repo, found.number) } : null;
    return { assignees: i.assignees ?? [], state: i.state, stateReason: i.state_reason ?? null, closedAt: i.closed_at ?? null, devPull };
  } catch {
    return null;
  }
}

/** The designer's last answer Bridge posted on the developers' pull request, or null. One read. */
async function lastAnswerOn(repo: string, number: number): Promise<{ kind: 'looks-right' | 'changes'; login: string } | null> {
  try {
    const c = await ghGet<{ body?: string | null; user?: { login?: string } | null; created_at?: string }[]>(`/repos/${repo}/issues/${number}/comments?per_page=100`);
    const a = designReviewOf(c.data ?? []);
    return a?.login ? { kind: a.kind, login: a.login } : null;
  } catch {
    return null;
  }
}

/** The developers' pull request with its branch and the last design review Bridge posted on it (two reads at once). */
export async function readDevPull(repo: string, pull: DevPull): Promise<{ pull: DevPull; answer: ReturnType<typeof designReviewOf> }> {
  const [p, comments] = await Promise.all([
    ghGet<{ head?: { ref?: string; sha?: string } | null; draft?: boolean }>(`/repos/${repo}/pulls/${pull.number}`).catch(() => null),
    ghGet<{ body?: string | null; user?: { login?: string } | null; created_at?: string }[]>(`/repos/${repo}/issues/${pull.number}/comments?per_page=100`).catch(() => null),
  ]);
  const sha = p?.data.head?.sha ?? null;
  return {
    pull: { ...pull, headRef: p?.data.head?.ref ?? null, deployedUrl: sha ? await deployedUrlOf(repo, sha) : null, ...(p?.data.draft !== undefined ? { draft: p.data.draft } : {}) },
    answer: comments ? designReviewOf(comments.data ?? []) : null,
  };
}

/**
 * The address of a commit's deployment: the latest one GitHub lists (Vercel, Netlify and most hosts report it there),
 * else the preview a Cloudflare Pages check run names. Null when none. Two reads, three for Cloudflare.
 */
async function deployedUrlOf(repo: string, sha: string): Promise<string | null> {
  try {
    const list = await ghGet<{ id: number }[]>(`/repos/${repo}/deployments?sha=${sha}&per_page=1`);
    const id = list.data?.[0]?.id;
    if (id) {
      const statuses = await ghGet<{ state?: string; environment_url?: string | null }[]>(`/repos/${repo}/deployments/${id}/statuses?per_page=5`);
      const url = statuses.data?.find((st) => st.state === 'success' && st.environment_url)?.environment_url ?? null;
      if (url) return url;
    }
    const runs = await ghGet<{ check_runs?: { name: string; status: string; conclusion?: string | null; app?: { slug?: string } | null; output?: { summary?: string | null; text?: string | null } | null }[] }>(`/repos/${repo}/commits/${sha}/check-runs?per_page=100`);
    for (const c of runs.data?.check_runs ?? []) {
      const run = { name: c.name, status: c.status, app: c.app?.slug ?? null, summary: c.output?.summary ?? null, text: c.output?.text ?? null };
      if (!isCloudflareCheck(run) || c.conclusion !== 'success') continue;
      const links = parseCloudflareCheck(run);
      if (links) return links.branchUrl ?? links.commitUrl;
    }
    return null;
  } catch {
    return null;
  }
}

/** Posts the designer's answer on the developers' pull request, with the signed-in viewer's GitHub session. */
export async function answerDevPull(repo: string, number: number, answer: DesignAnswer): Promise<void> {
  await ghWrite('POST', `/repos/${repo}/issues/${number}/comments`, { body: designReviewComment(answer) });
}

/** Task stages read in this page, by task URL, for a minute: Home, Changes and the product page read the same tasks. */
const stageCache = new Map<string, { at: number; stage: Promise<LifecycleStage | null> }>();
const STAGE_TTL = 60_000;
/** The most tasks one list reads at once: the GitHub quota is shared with the rest of Studio. */
const MAX_TASK_READS = 20;

/**
 * The stage of each handed-off design copy exploration from its task (taskStage over readDesignTask), keyed by task
 * URL: the lists say Waiting to be picked up, Being built, In review or Shipped as Being built and its page do.
 * Parallel, bounded, cached a minute. Explorations without a task are left out.
 */
export async function designTaskStages(pulls: readonly { body?: string | null }[]): Promise<Map<string, LifecycleStage>> {
  const urls = [...new Set(pulls.map((p) => parseExplorationBody(p.body ?? null)?.task ?? null).filter((u): u is string => Boolean(u && taskRef(u))))].slice(0, MAX_TASK_READS);
  const now = Date.now();
  const read = await Promise.all(
    urls.map(async (u) => {
      let hit = stageCache.get(u);
      if (!hit || now - hit.at > STAGE_TTL) {
        hit = { at: now, stage: readDesignTask(u).then((t) => (t ? taskStage(t) : null)) };
        stageCache.set(u, hit);
      }
      return [u, await hit.stage] as const;
    }),
  );
  return new Map(read.filter((x): x is readonly [string, LifecycleStage] => x[1] !== null));
}

/** The task URL of an exploration's pull request body, or null. */
export const taskUrlOf = (body: string | null | undefined): string | null => parseExplorationBody(body ?? null)?.task ?? null;
