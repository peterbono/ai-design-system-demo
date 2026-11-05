// Approving Claude's Figma fixes from the plugin (docs/FIGMA-FIXES.md, "Approve from Figma"), behind /api/ship:
//
//   POST /api/ship { repo, action: "can-approve-fixes" }
//     -> 200 { canApprove: boolean }            whether this person sees "Approve all" and "Approve" in the plugin
//   POST /api/ship { repo, action: "approve-fixes", prs: [873, 874], heads?: { "873": "<sha>" } }
//     -> 200 { approved: [{ pr }], refused: [{ pr, code, reason }], landed, how?, commit? }
//     -> 403 not_lead, 401 signin                  the call itself was refused
//
// Who approves: the team's leads. A GitHub sign-in (the plugin's token) that is a repository admin, or that can write
// and is in the design approver list of bridge.config.json on the default branch (governance.owners and rights, a team
// entry counting its active members), the Reviewer of design in Studio. An email member signed in to Studio (the
// contribute cookie or a Bridge account session, `X-Bridge-Contribute: 1`) approves when they are an Admin of the team.
// Everyone else keeps "Waiting for approval".
//
// What Bridge checks, with its own app token, before anything lands, for each pull request:
//   - open, to the default branch, from the repository itself, labelled `figma-fixes`, on a `figma-fixes-` branch;
//   - figma-fixes.json is the only file it changes, and its head is the one the plugin showed (`heads`, when sent);
//   - no automatic check failed or is still running on its head;
//   - figma-fixes.json at its head passes `bridge fixes check` (api/_lib/figma-fixes-check.ts), it only adds or
//     changes fixes (never takes one out), and the fixes it changes were not changed on the default branch since.
// Then the fixes of every accepted pull request are laid on the default branch's figma-fixes.json, by id, in the order
// asked, and the result passes `bridge fixes check` again (a pull request that breaks it is refused, the others land).
//
// How it lands (one push to the default branch, so one deployment, whatever the count):
//   - one pull request whose figma-fixes.json the default branch did not touch since: GitHub merges it (squash first);
//   - otherwise one merge commit whose parents are the default branch and the head of every accepted pull request,
//     holding the union: the default branch moves to it, so GitHub marks each pull request merged (as #867 and #896).
//     When the branch rules refuse that push, the commit goes on a branch of its own, in a pull request Bridge merges,
//     or arms to merge once the checks pass (`landed: false`).

import { approverEntriesOf } from './figma-ship.js';
import { FIGMA_FIXES_FILE, FIGMA_FIXES_VERSION, validateFigmaFixes } from './figma-fixes-check.js';
import { GITHUB_DOWN, HttpError, type FetchLike } from './http.js';
import type { TeamCaller } from './team-caller.js';
import { isLead } from './tier1-publish.js';

/** The app token's permissions for approving: write the branch and merge, read the checks. */
export const APPROVE_PERMISSIONS = { contents: 'write', pull_requests: 'write', checks: 'read', statuses: 'read' } as const;
export const FIXES_LABEL = 'figma-fixes';
/** At most this many fixes in one approval (one request, one push). */
export const MAX_APPROVE = 50;

export type ApproveCode =
  | 'not_open'
  | 'not_fix'
  | 'not_only_fixes'
  | 'moved'
  | 'checks_failed'
  | 'checks_pending'
  | 'not_valid'
  | 'removes'
  | 'changed_underneath'
  | 'same_fix';

/** Designer words: what happened to this fix and what to do. Never a check name, a conflict or a branch. */
export const APPROVE_WORDS: Record<ApproveCode, string> = {
  not_open: 'This fix is no longer waiting: it was approved or closed already.',
  not_fix: "This is not one of Claude's Figma fixes, so it is approved on GitHub.",
  not_only_fixes: "This fix changes more than Claude's fixes, so a developer looks at it.",
  moved: 'This fix changed since you looked at it. Check it again, then approve.',
  checks_failed: 'Something needs a developer before this fix comes in. They are told on GitHub.',
  checks_pending: 'Bridge is still checking this fix. Approve it again in a minute.',
  not_valid: "Claude's fix does not pass Bridge's check, so it can't come into Figma. Ask Claude to fix it again.",
  removes: 'This fix takes out fixes already in the library, so a developer looks at it.',
  changed_underneath: 'The library changed the same fix since Claude proposed it. Ask Claude to fix it again.',
  same_fix: 'Another fix you approved changes the same thing, so that one was kept. Ask Claude to fix this one again.',
};

export const APPROVE_ERROR_WORDS = {
  notLead: "Only the team's leads and admins approve Claude's fixes.",
  appMissing: 'Bridge cannot approve on this library yet. A developer approves the fixes on GitHub.',
  none: 'Say which fixes to approve.',
  tooMany: `Approve at most ${MAX_APPROVE} fixes at a time.`,
} as const;

export interface ApproveResult {
  approved: { pr: number }[];
  refused: { pr: number; code: ApproveCode; reason: string }[];
  /** true: on the default branch now (Check for updates brings them in). false: they land once the checks pass. */
  landed: boolean;
  how?: 'merged' | 'together' | 'armed';
  commit?: string;
}

type Call = (method: string, path: string, body?: unknown, accept?: string) => Promise<{ status: number; data: any }>;

function gh(f: FetchLike, token: string): { call: Call; raw: (owner: string, repo: string, path: string, ref: string) => Promise<string | null> } {
  const call: Call = async (method, path, body, accept = 'application/vnd.github+json') => {
    let res: Response;
    try {
      res = await f(`https://api.github.com${path}`, {
        method,
        headers: { Accept: accept, Authorization: `Bearer ${token}`, 'User-Agent': 'bridge-approve-fixes', 'X-GitHub-Api-Version': '2022-11-28', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new HttpError(502, 'unreachable', GITHUB_DOWN);
    }
    if (res.status >= 500) throw new HttpError(502, 'unreachable', GITHUB_DOWN);
    if (accept.endsWith('.raw')) return { status: res.status, data: res.status === 200 ? await res.text() : null };
    let data: any = null;
    try {
      data = res.status === 204 ? null : await res.json();
    } catch {
      data = null;
    }
    return { status: res.status, data };
  };
  const raw = async (owner: string, repo: string, path: string, ref: string) => {
    const r = await call('GET', `/repos/${owner}/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`, undefined, 'application/vnd.github.raw');
    if (r.status === 404) return null;
    if (r.status !== 200 || typeof r.data !== 'string') throw new HttpError(502, 'unreachable', GITHUB_DOWN);
    return r.data;
  };
  return { call, raw };
}

/**
 * Whether the caller approves Claude's fixes on this team: a GitHub admin of the repository, a GitHub sign-in that can
 * write and is a design approver (a team entry counts its active members, read with the app token), or an email Admin.
 */
export async function canApproveFixes(f: FetchLike, appToken: string, owner: string, repo: string, who: TeamCaller): Promise<boolean> {
  if (who.admin) return true;
  if (who.kind !== 'github' || !who.login || !who.canEdit) return false;
  const { call, raw } = gh(f, appToken);
  const r = await call('GET', `/repos/${owner}/${repo}`);
  if (r.status !== 200) throw new HttpError(502, 'unreachable', GITHUB_DOWN);
  let config: unknown = null;
  try {
    const text = await raw(owner, repo, 'bridge.config.json', String(r.data?.default_branch ?? 'main'));
    config = text ? JSON.parse(text) : null;
  } catch (e) {
    if (e instanceof HttpError) throw e;
  }
  const design = approverEntriesOf(config).design;
  if (isLead(who.login, { admin: false, approvers: design })) return true;
  for (const team of design.filter((x) => x.includes('/'))) {
    const [org, slug] = team.replace(/^@/, '').split('/');
    if (!org || !slug) continue;
    const m = await call('GET', `/orgs/${encodeURIComponent(org)}/teams/${encodeURIComponent(slug)}/memberships/${encodeURIComponent(who.login)}`).catch(() => null);
    if (m?.status === 200 && m.data?.state === 'active') return true;
  }
  return false;
}

type Fix = Record<string, unknown> & { id: string };
interface FixesFile {
  raw: Record<string, unknown>;
  fixes: Fix[];
}

/** figma-fixes.json as text: null when it does not parse or is not a fixes file Bridge can merge by id. */
function readFixes(text: string | null): FixesFile | null {
  if (text === null) return { raw: { version: FIGMA_FIXES_VERSION }, fixes: [] };
  try {
    const raw = JSON.parse(text) as Record<string, unknown>;
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.fixes)) return null;
    if (!raw.fixes.every((x) => x && typeof x === 'object' && typeof (x as Fix).id === 'string')) return null;
    return { raw, fixes: raw.fixes as Fix[] };
  } catch {
    return null;
  }
}

/** Same fix: same keys and values, whatever the key order. */
function sameFix(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === (b as unknown[]).length && a.every((x, i) => sameFix(x, (b as unknown[])[i]));
  const ka = Object.keys(a as object).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b as object).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  return ka.length === kb.length && ka.every((k) => sameFix((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** One pull request, read and checked: what it proposes over its merge base. */
interface Candidate {
  pr: number;
  head: string;
  /** Fixes it adds or changes, as they are at its head. */
  proposed: Fix[];
  /** Its merge base's version of each fix, by id (to see whether the default branch changed it since). */
  base: Map<string, Fix>;
  /** The default branch's figma-fixes.json did not change since its merge base: merging it alone gives its head file. */
  clean: boolean;
}

/** The union of the default branch's fixes and the accepted pull requests', by id, in the order asked. Exported for tests. */
export function unionFixes(main: Fix[], candidates: readonly Candidate[]): { fixes: Fix[]; accepted: number[]; refused: { pr: number; code: ApproveCode }[] } {
  let work = main.map((x) => x);
  const mainById = new Map(main.map((x) => [x.id, x]));
  /** Which pull request of this approval set each id. */
  const setBy = new Map<string, number>();
  const accepted: number[] = [];
  const refused: { pr: number; code: ApproveCode }[] = [];
  for (const c of candidates) {
    const next = work.map((x) => x);
    const mine = new Map<string, number>();
    let code: ApproveCode | null = null;
    for (const p of c.proposed) {
      const at = next.findIndex((x) => x.id === p.id);
      if (at < 0) {
        // Its merge base had it, the default branch no longer does: taken out since.
        if (c.base.has(p.id) && !mainById.has(p.id)) code = 'changed_underneath';
        else next.push(p);
      } else if (!sameFix(next[at], p)) {
        if (setBy.has(p.id)) code = 'same_fix';
        else if (c.base.has(p.id) && sameFix(mainById.get(p.id), c.base.get(p.id))) next[at] = p;
        else code = 'changed_underneath';
      }
      if (code) break;
      mine.set(p.id, c.pr);
    }
    if (!code && validateFigmaFixes({ version: FIGMA_FIXES_VERSION, fixes: next }).length) code = 'not_valid';
    if (code) {
      refused.push({ pr: c.pr, code });
      continue;
    }
    work = next;
    for (const [id, pr] of mine) setBy.set(id, pr);
    accepted.push(c.pr);
  }
  return { fixes: work, accepted, refused };
}

const MERGE_METHODS = [
  ['allow_squash_merge', 'squash'],
  ['allow_merge_commit', 'merge'],
  ['allow_rebase_merge', 'rebase'],
] as const;

async function ciState(call: Call, owner: string, repo: string, sha: string): Promise<'pass' | 'fail' | 'pending'> {
  const [runs, statuses] = await Promise.all([call('GET', `/repos/${owner}/${repo}/commits/${sha}/check-runs?per_page=100`), call('GET', `/repos/${owner}/${repo}/commits/${sha}/status`)]);
  if (runs.status !== 200 || statuses.status !== 200) return 'pending';
  const OK = new Set(['success', 'neutral', 'skipped']);
  let pending = false;
  for (const r of runs.data?.check_runs ?? []) {
    if (r.status !== 'completed') pending = true;
    else if (!OK.has(r.conclusion)) return 'fail';
  }
  for (const s of statuses.data?.statuses ?? []) {
    if (s.state === 'pending') pending = true;
    else if (s.state !== 'success') return 'fail';
  }
  return pending ? 'pending' : 'pass';
}

const labelNames = (labels: unknown): string[] => (Array.isArray(labels) ? labels.map((l) => String(typeof l === 'string' ? l : (l?.name ?? '')).toLowerCase()) : []);

/** One pull request against the rules above: a candidate, or why not. */
async function readCandidate(g: ReturnType<typeof gh>, owner: string, repo: string, defaultBranch: string, n: number, expectedHead: string | undefined, mainFixesSha: string | null): Promise<Candidate | ApproveCode> {
  const base = `/repos/${owner}/${repo}`;
  const prR = await g.call('GET', `${base}/pulls/${n}`);
  if (prR.status === 404) return 'not_fix';
  if (prR.status !== 200) throw new HttpError(502, 'unreachable', GITHUB_DOWN);
  const pr = prR.data;
  if (pr.state !== 'open' || pr.merged_at) return 'not_open';
  const headRepo = String(pr.head?.repo?.full_name ?? '').toLowerCase();
  if (pr.base?.ref !== defaultBranch || headRepo !== `${owner}/${repo}`.toLowerCase()) return 'not_fix';
  if (!labelNames(pr.labels).includes(FIXES_LABEL) || !/(^|\/)figma-fixes-[a-z0-9-]+$/.test(String(pr.head?.ref ?? ''))) return 'not_fix';
  const head = String(pr.head?.sha ?? '');
  if (expectedHead && expectedHead !== head) return 'moved';
  const files = await g.call('GET', `${base}/pulls/${n}/files?per_page=100`);
  if (files.status !== 200 || !Array.isArray(files.data)) throw new HttpError(502, 'unreachable', GITHUB_DOWN);
  if (files.data.length !== 1 || files.data[0]?.filename !== FIGMA_FIXES_FILE || !['added', 'modified'].includes(String(files.data[0]?.status))) return 'not_only_fixes';
  const ci = await ciState(g.call, owner, repo, head);
  if (ci === 'fail') return 'checks_failed';
  if (ci === 'pending') return 'checks_pending';
  const cmp = await g.call('GET', `${base}/compare/${encodeURIComponent(defaultBranch)}...${head}`);
  const mergeBase = cmp.status === 200 ? String(cmp.data?.merge_base_commit?.sha ?? '') : '';
  if (!mergeBase) throw new HttpError(502, 'unreachable', GITHUB_DOWN);
  const [atHead, atBase, baseBlob] = await Promise.all([g.raw(owner, repo, FIGMA_FIXES_FILE, head), g.raw(owner, repo, FIGMA_FIXES_FILE, mergeBase), blobSha(g.call, owner, repo, mergeBase)]);
  const headFile = readFixes(atHead);
  const baseFile = readFixes(atBase);
  if (!headFile || !baseFile || atHead === null) return 'not_valid';
  if (validateFigmaFixes(JSON.parse(atHead)).length) return 'not_valid';
  const headIds = new Set(headFile.fixes.map((x) => x.id));
  if (baseFile.fixes.some((x) => !headIds.has(x.id))) return 'removes';
  const baseById = new Map(baseFile.fixes.map((x) => [x.id, x]));
  return { pr: n, head, proposed: headFile.fixes.filter((x) => !sameFix(baseById.get(x.id), x)), base: baseById, clean: baseBlob === mainFixesSha };
}

/** The blob of figma-fixes.json at a commit (null when absent): two refs hold the same file when their blobs match. */
async function blobSha(call: Call, owner: string, repo: string, ref: string): Promise<string | null> {
  const r = await call('GET', `/repos/${owner}/${repo}/contents/${FIGMA_FIXES_FILE}?ref=${encodeURIComponent(ref)}`);
  if (r.status === 404) return null;
  if (r.status !== 200) throw new HttpError(502, 'unreachable', GITHUB_DOWN);
  return typeof r.data?.sha === 'string' ? r.data.sha : null;
}

/** "#873 and #874", "#873, #874 and #876". */
const listPrs = (prs: readonly number[]) => (prs.length > 1 ? `${prs.slice(0, -1).map((n) => `#${n}`).join(', ')} and #${prs.at(-1)}` : `#${prs[0]}`);

/** The merge commit message: who approved, from where, and what it holds. */
export function approveMessage(who: string, prs: readonly number[]): string {
  const title = prs.length === 1 ? `fix(figma): land Claude's Figma fix ${listPrs(prs)}` : `fix(figma): land Claude's Figma fixes for ${prs.length} components in one merge`;
  return `${title}\n\nApproved by ${who.trim() || 'a lead'} in the Figma plugin. figma-fixes.json holds the fixes of ${listPrs(prs)}, laid on the default branch by id and checked with bridge fixes check. Each pull request's head is a parent of this commit, so GitHub marks it merged.`;
}

/**
 * Approves and lands Claude's fixes. `who`: the approver's name, for the commit message. `heads`: the head each pull
 * request had when the approver saw it, when the plugin knows it. Exported for tests.
 */
export async function approveFixes(f: FetchLike, token: string, owner: string, repo: string, prs: readonly number[], who: string, heads: Record<string, string> = {}): Promise<ApproveResult> {
  const g = gh(f, token);
  const base = `/repos/${owner}/${repo}`;
  const repoR = await g.call('GET', base);
  if (repoR.status !== 200) throw new HttpError(502, 'unreachable', GITHUB_DOWN);
  const r = repoR.data;
  const branch = String(r.default_branch ?? 'main');
  const refR = await g.call('GET', `${base}/git/ref/heads/${encodeURIComponent(branch)}`);
  const mainSha = String(refR.data?.object?.sha ?? '');
  if (refR.status !== 200 || !mainSha) throw new HttpError(502, 'unreachable', GITHUB_DOWN);
  const [mainText, mainBlob] = await Promise.all([g.raw(owner, repo, FIGMA_FIXES_FILE, mainSha), blobSha(g.call, owner, repo, mainSha)]);
  const mainFile = readFixes(mainText);
  if (!mainFile) throw new HttpError(409, 'main_invalid', "The library's fixes file needs a developer before Claude's fixes come in.");

  const refused: ApproveResult['refused'] = [];
  const candidates: Candidate[] = [];
  for (const n of prs) {
    const c = await readCandidate(g, owner, repo, branch, n, heads[String(n)], mainBlob);
    if (typeof c === 'string') refused.push({ pr: n, code: c, reason: APPROVE_WORDS[c] });
    else candidates.push(c);
  }
  const u = unionFixes(mainFile.fixes, candidates);
  for (const x of u.refused) refused.push({ pr: x.pr, code: x.code, reason: APPROVE_WORDS[x.code] });
  const accepted = candidates.filter((c) => u.accepted.includes(c.pr));
  if (!accepted.length) return { approved: [], refused, landed: false };
  const approved = accepted.map((c) => ({ pr: c.pr }));

  // One pull request on an unchanged fixes file: GitHub merges it as it is.
  if (accepted.length === 1 && accepted[0]!.clean) {
    const c = accepted[0]!;
    const merged = await mergeOne(g.call, owner, repo, r, c.pr, c.head, approveMessage(who, [c.pr]));
    if (merged) return { approved, refused, landed: true, how: 'merged', commit: merged };
  }

  // The union, in one merge commit whose parents are the default branch and every accepted head.
  const text = `${JSON.stringify({ ...mainFile.raw, version: mainFile.raw.version ?? FIGMA_FIXES_VERSION, fixes: u.fixes }, null, 2)}\n`;
  const commitR = await g.call('GET', `${base}/git/commits/${mainSha}`);
  const baseTree = String(commitR.data?.tree?.sha ?? '');
  if (commitR.status !== 200 || !baseTree) throw new HttpError(502, 'unreachable', GITHUB_DOWN);
  const blob = await g.call('POST', `${base}/git/blobs`, { content: text, encoding: 'utf-8' });
  const tree = blob.status === 201 ? await g.call('POST', `${base}/git/trees`, { base_tree: baseTree, tree: [{ path: FIGMA_FIXES_FILE, mode: '100644', type: 'blob', sha: blob.data?.sha }] }) : null;
  const message = approveMessage(who, accepted.map((c) => c.pr));
  const commit = tree?.status === 201 ? await g.call('POST', `${base}/git/commits`, { message, tree: tree.data?.sha, parents: [mainSha, ...accepted.map((c) => c.head)] }) : null;
  const sha = commit?.status === 201 ? String(commit.data?.sha ?? '') : '';
  if (!sha) throw new HttpError(502, 'unreachable', GITHUB_DOWN);
  // A fast-forward of the default branch: refused when it moved meanwhile (approve again) or when its rules ask for a
  // pull request the app cannot bypass (then one pull request carries the commit).
  const move = await g.call('PATCH', `${base}/git/refs/heads/${encodeURIComponent(branch)}`, { sha, force: false });
  if (move.status === 200) return { approved, refused, landed: true, how: 'together', commit: sha };
  const now = await g.call('GET', `${base}/git/ref/heads/${encodeURIComponent(branch)}`);
  if (now.status === 200 && now.data?.object?.sha !== mainSha) throw new HttpError(409, 'moved', 'The library changed while Bridge was approving. Approve again.');
  return landThroughPull(g.call, owner, repo, r, branch, sha, message, approved, refused);
}

/** Merges one pull request (ready for review first: GitHub refuses a draft). The merge commit, or null when refused. */
async function mergeOne(call: Call, owner: string, repo: string, r: any, n: number, head: string, message: string): Promise<string | null> {
  const base = `/repos/${owner}/${repo}`;
  const prR = await call('GET', `${base}/pulls/${n}`);
  if (prR.data?.draft && prR.data?.node_id) await call('POST', '/graphql', { query: 'mutation($id:ID!){markPullRequestReadyForReview(input:{pullRequestId:$id}){pullRequest{isDraft}}}', variables: { id: prR.data.node_id } });
  const method = MERGE_METHODS.find(([k]) => r[k] !== false)?.[1] ?? 'merge';
  const [title, ...rest] = message.split('\n\n');
  const m = await call('PUT', `${base}/pulls/${n}/merge`, { sha: head, merge_method: method, commit_title: `${title} (#${n})`, commit_message: rest.join('\n\n') });
  return m.status === 200 && m.data?.merged !== false ? String(m.data?.sha ?? '') || head : null;
}

/** The union commit on a branch of its own, in one pull request Bridge merges with a merge commit (or arms). */
async function landThroughPull(call: Call, owner: string, repo: string, r: any, branch: string, sha: string, message: string, approved: ApproveResult['approved'], refused: ApproveResult['refused']): Promise<ApproveResult> {
  const base = `/repos/${owner}/${repo}`;
  const name = `bridge/figma-fixes-approved-${sha.slice(0, 7)}`;
  const ref = await call('POST', `${base}/git/refs`, { ref: `refs/heads/${name}`, sha });
  if (ref.status !== 201 && ref.status !== 422) throw new HttpError(502, 'unreachable', GITHUB_DOWN);
  const [title, ...rest] = message.split('\n\n');
  const pr = await call('POST', `${base}/pulls`, { title, head: name, base: branch, body: rest.join('\n\n') });
  const n = Number(pr.data?.number);
  if (pr.status !== 201 || !n) throw new HttpError(502, 'unreachable', GITHUB_DOWN);
  await call('POST', `${base}/issues/${n}/labels`, { labels: [FIXES_LABEL] }).catch(() => null);
  // A merge commit, never squash: the heads must land for GitHub to mark each pull request merged.
  if (r.allow_merge_commit !== false) {
    const m = await call('PUT', `${base}/pulls/${n}/merge`, { sha, merge_method: 'merge' });
    if (m.status === 200) return { approved, refused, landed: true, how: 'together', commit: String(m.data?.sha ?? sha) };
    if (pr.data?.node_id) {
      const armed = await call('POST', '/graphql', { query: 'mutation($id:ID!,$oid:GitObjectID!){enablePullRequestAutoMerge(input:{pullRequestId:$id,mergeMethod:MERGE,expectedHeadOid:$oid}){pullRequest{number}}}', variables: { id: pr.data.node_id, oid: sha } });
      if (armed.status === 200 && !armed.data?.errors?.length) return { approved, refused, landed: false, how: 'armed', commit: sha };
    }
  }
  return { approved, refused, landed: false, commit: sha };
}

/** The pull request numbers of a request body: 1 to MAX_APPROVE distinct positive integers. */
export function parsePrs(v: unknown): number[] {
  if (!Array.isArray(v) || !v.length) throw new HttpError(400, 'bad_request', APPROVE_ERROR_WORDS.none);
  const out = [...new Set(v.map((x) => (typeof x === 'number' || typeof x === 'string' ? String(x) : '')))];
  if (out.some((x) => !/^[1-9]\d{0,9}$/.test(x))) throw new HttpError(400, 'bad_request', APPROVE_ERROR_WORDS.none);
  if (out.length > MAX_APPROVE) throw new HttpError(400, 'bad_request', APPROVE_ERROR_WORDS.tooMany);
  return out.map(Number);
}

/** `heads` of a request body: pull request number -> head commit, only well formed entries. */
export function parseHeads(v: unknown): Record<string, string> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k, s]) => /^[1-9]\d{0,9}$/.test(k) && typeof s === 'string' && /^[0-9a-f]{40}$/i.test(s))) as Record<string, string>;
}
