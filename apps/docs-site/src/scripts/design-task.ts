// The developers' task Done exploring opened from the design team's copy: one read of the issue, and its timeline while
// it is open (the developers' pull request that links it, for the Review step).
import { designReviewComment, designReviewOf, devPullOfTimeline, taskStage, type LifecycleStage, type DesignAnswer, type DesignTaskRead, type DevPull, type TaskCommentLike, type TimelineEventLike } from '../lib/review-state';
import { isCloudflareCheck, parseCloudflareCheck, parseExplorationBody } from '@bridge-ds/core';
import { ghGet, ghWrite } from './github-session';
import { canonicalRepo } from '../lib/team-path';

const TASK_URL = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/(\d+)$/;

/**
 * The repository and number of a task URL, or null. The repository under its current name: a link stored before a
 * rename (art-print-shop-co/...) is read by the new name, so GitHub answers at once instead of with a redirect.
 */
export function taskRef(url: string): { repo: string; number: number } | null {
  const m = TASK_URL.exec(url.trim());
  return m ? { repo: canonicalRepo(m[1]!), number: Number(m[2]) } : null;
}

/**
 * A design copy exploration's task in the developers' repository (its issue URL): null when it cannot be read. Its
 * timeline is read at the same time (one more call, bounded to the first page): an open pull request of the
 * developers that links it is the Review step. A timeline GitHub refuses leaves the task as it is. Only when the task
 * has comments, one more read of those since Done exploring (`doneAt`): a question of the developers, or their word
 * when they closed it. `shipped`: once it shipped, the merged pull request's design review too (one read, kept for
 * the session, so who said it looks right stays on the Reviewed step).
 */
export async function readDesignTask(url: string, opts: { doneAt?: string | null; shipped?: boolean; comments?: boolean } = {}): Promise<DesignTaskRead | null> {
  const ref = taskRef(url);
  if (!ref) return null;
  try {
    const [issue, timeline] = await Promise.all([
      ghGet<{ assignees?: { login: string }[] | null; state: string; state_reason?: string | null; closed_at?: string | null; comments?: number; labels?: ({ name?: string } | string)[] | null }>(`/repos/${ref.repo}/issues/${ref.number}`),
      ghGet<TimelineEventLike[]>(`/repos/${ref.repo}/issues/${ref.number}/timeline?per_page=100`).catch(() => null),
    ]);
    const i = issue.data;
    const found = i.state === 'open' && timeline ? devPullOfTimeline(timeline.data ?? [], ref.repo) : null;
    // Their pull request's comments: the designer's last answer, for the lists' Review line. One more read, only then.
    const devPull = found ? { ...found, answer: await lastAnswerOn(ref.repo, found.number) } : null;
    const comments = opts.comments !== false && (i.comments ?? 0) > 0 ? await taskComments(ref.repo, ref.number, opts.doneAt ?? null) : null;
    const merged = opts.shipped && i.state === 'closed' && i.state_reason === 'completed' && timeline ? devPullOfTimeline(timeline.data ?? [], ref.repo, { merged: true }) : null;
    const shippedAnswer = merged ? await shippedAnswerOn(ref.repo, merged.number) : null;
    const labels = (i.labels ?? []).map((l) => (typeof l === 'string' ? l : (l.name ?? ''))).filter(Boolean);
    return { assignees: i.assignees ?? [], state: i.state, stateReason: i.state_reason ?? null, closedAt: i.closed_at ?? null, devPull, labels, comments, ...(shippedAnswer ? { shippedAnswer } : {}) };
  } catch {
    return null;
  }
}

/** The task's comments since Done exploring (oldest first), only the fields Bridge reads; null when GitHub refuses. One read. */
async function taskComments(repo: string, number: number, since: string | null): Promise<TaskCommentLike[] | null> {
  try {
    const q = since && !Number.isNaN(Date.parse(since)) ? `&since=${encodeURIComponent(new Date(since).toISOString())}` : '';
    const c = await ghGet<TaskCommentLike[]>(`/repos/${repo}/issues/${number}/comments?per_page=100${q}`);
    return (c.data ?? []).map((x) => ({ body: typeof x.body === 'string' ? x.body.slice(0, 4000) : null, user: x.user ? { login: x.user.login ?? '', type: x.user.type ?? '' } : null, created_at: x.created_at ?? '' }));
  } catch {
    return null;
  }
}

/** Who answered on a merged pull request of the developers: read once a session (it no longer changes). */
const shippedAnswers = new Map<string, Promise<{ kind: 'looks-right' | 'changes'; login: string } | null>>();
function shippedAnswerOn(repo: string, number: number) {
  const k = `${repo.toLowerCase()}#${number}`;
  let hit = shippedAnswers.get(k);
  if (!hit) {
    hit = lastAnswerOn(repo, number);
    shippedAnswers.set(k, hit);
  }
  return hit;
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

/** Tasks read in this page, by task URL, for a minute: Home, Changes and the product page read the same tasks. */
const taskCache = new Map<string, { at: number; task: Promise<DesignTaskRead | null> }>();
const STAGE_TTL = 60_000;
/** The most tasks one list reads at once: the GitHub quota is shared with the rest of Studio. */
const MAX_TASK_READS = 20;

/**
 * The task of each handed-off design copy exploration (readDesignTask), keyed by task URL, with the comments since
 * its Done exploring when it has any. Parallel, bounded, cached a minute, shared by Home, Changes and the product page.
 * Explorations without a task are left out.
 */
export async function designTaskReads(pulls: readonly { body?: string | null }[]): Promise<Map<string, DesignTaskRead>> {
  const blocks = new Map<string, string | null>();
  for (const p of pulls) {
    const b = parseExplorationBody(p.body ?? null);
    if (b?.task && taskRef(b.task) && !blocks.has(b.task)) blocks.set(b.task, b.doneAt ?? null);
  }
  const now = Date.now();
  const read = await Promise.all(
    [...blocks].slice(0, MAX_TASK_READS).map(async ([u, doneAt]) => {
      let hit = taskCache.get(u);
      if (!hit || now - hit.at > STAGE_TTL) {
        hit = { at: now, task: readDesignTask(u, { doneAt }) };
        taskCache.set(u, hit);
      }
      return [u, await hit.task] as const;
    }),
  );
  return new Map(read.filter((x): x is readonly [string, DesignTaskRead] => x[1] !== null));
}

/**
 * The stage of each handed-off design copy exploration from its task (taskStage over designTaskReads), keyed by task
 * URL: the lists say Waiting to be picked up, Being built, In review, Approved, waiting to ship, Shipped or Not
 * planned as Being built and its page do.
 */
export async function designTaskStages(pulls: readonly { body?: string | null }[]): Promise<Map<string, LifecycleStage>> {
  const reads = await designTaskReads(pulls);
  return new Map([...reads].map(([u, t]) => [u, taskStage(t)] as const));
}

/** After the designer's reply on a task: its next read comes from GitHub again, not from the minute's cache. */
export const forgetDesignTask = (url: string) => void taskCache.delete(url);

/**
 * Posts the designer's reply on the developers' task, through the viewer's own write route (`client`: their GitHub
 * token, or Bridge for a member without GitHub, whose proxy allows a comment on their own task only).
 */
export async function replyOnTask(client: { withBranchPrefix(p: undefined): { forRepo(repo: string): { createIssueComment(n: number, body: string): Promise<unknown> } } }, url: string, text: string): Promise<void> {
  const ref = taskRef(url);
  const body = text.trim();
  if (!ref || !body) throw new Error('Write your answer first.');
  await client.withBranchPrefix(undefined).forRepo(ref.repo).createIssueComment(ref.number, body.slice(0, 4000));
  forgetDesignTask(url);
}

/**
 * The developers' questions that wait on this viewer (task URLs), remembered on this browser by Home so the nav badge
 * counts them on every page without reading the tasks again. Cleared per task when the viewer replies.
 */
const QUESTIONS_KEY = 'bridge.dev-questions';

export function rememberQuestions(viewer: string | null, urls: readonly string[]) {
  try {
    localStorage.setItem(QUESTIONS_KEY, JSON.stringify({ viewer, urls: [...new Set(urls)] }));
  } catch {
    /* private mode: the badge counts them on Home only */
  }
}

export function rememberedQuestions(viewer: string | null): string[] {
  if (!viewer) return [];
  try {
    const v = JSON.parse(localStorage.getItem(QUESTIONS_KEY) || 'null') as { viewer?: unknown; urls?: unknown } | null;
    return v && v.viewer === viewer && Array.isArray(v.urls) ? v.urls.filter((u): u is string => typeof u === 'string') : [];
  } catch {
    return [];
  }
}

export function forgetQuestion(viewer: string | null, url: string) {
  const left = rememberedQuestions(viewer).filter((u) => u !== url);
  rememberQuestions(viewer, left);
}

/** The task URL of an exploration's pull request body, or null. */
export const taskUrlOf = (body: string | null | undefined): string | null => parseExplorationBody(body ?? null)?.task ?? null;
