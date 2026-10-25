// /api/ship: Bridge arms the merge of a token value change (docs/BUILD-REQUESTS.md, "Publishing from the plugin" and
// "Token values from Studio", decision TV-1). A push from the Figma plugin counts as design-approved; a token value
// change opened anywhere else (Studio, the CLI, the MCP server) once a design owner approved it. Token values (and new
// tokens) count as tech-approved, so they ship after the automatic checks with no developer in the loop. Renames and
// removals, code, and guardrail files never ship here: a developer approves them.
//
//   POST /api/ship  { repo: "owner/name", pr: 42 }
//     -> 200 { armed: true,  route: "shipped", merged?: true }
//     -> 200 { armed: false, route: "waiting-for-developer", code, reason, developer }   Bridge could not arm it: someone
//                                                                    adds it (reason: designer words, developer: the cause)
//     -> 4xx/5xx { error, message }                                         the call itself was refused
//
//   POST /api/ship  { repo: "owner/name", pr: 42, publish: "tier1" }   Tier 1 publish by leads (docs/GOVERNANCE.md)
//     -> 200 { armed: true,  route: "shipped", merged?: true }           published: merges once the checks pass
//     -> 200 { armed: false, route: "review", code, reason, developer }  not published: it waits for a review as usual
//   Only with a GitHub token (Bearer), whose account must be the author, a repository admin or in the approver list of
//   the change's domain, the change Tier 1 and governance.leadsPublishTier1 not false. A failing check: route review.
//
//   POST /api/ship  { repo: "owner/name", pr: 42, mark: "figma" }   the plugin, right after it opens its push
//     -> 200 { marked: true }                     Bridge wrote its signed mark into the body (author, head commit)
//     -> 200 { marked: false, code, reason, developer }   not marked: the push then ships only with a design approval
//   Only with a GitHub token (Bearer) whose account is the author and has write access; the pull request open, to the
//   default branch, from the repository itself, labelled as a push from Figma, and token values only at its head.
//
// Who may ask: a GitHub token that can read the repository (`Authorization: Bearer`, the Figma plugin and the CLI; any
// origin, no cookie, so CORS allows it), or an email member of the team signed in to Studio (the contribute cookie or
// a Bridge account session; `X-Bridge-Contribute: 1` from a page of this site). Asking never widens anything: Bridge
// re-reads the pull request with its own app token and arms it only when the rule says so, whoever asks.
//
// What it does, with an installation token of the Bridge app (contents and pull requests write, one repository):
//   1. reads the repository (default branch, merge settings), the pull request, its files and bridge.config.json;
//   2. refuses unless it is open, targets the default branch, is not an exploration, and its scope is `token-values`:
//      token files read at the merge base and at the head, compared token by token (a removed or renamed token is not
//      values), and its branch is in the repository itself (never a fork). A push from Figma needs nothing more, once
//      verified: the caller is its author with write access, and the body holds the mark Bridge signed for this pull
//      request, its author and its current head commit (api/_lib/figma-mark.ts; a label or a block alone never counts).
//      Changes requested still hold it. Any other pull request needs a design approval read from its reviews (core summarizeApprovals over the approver
//      lists of bridge.config.json on the default branch, a team entry counting its members when the app can read
//      them), given on its head commit, and no changes requested; and auto-merge allowed on the repository (nothing is
//      written otherwise);
//   3. marks it ready for review when it is a draft;
//   4. approves it with the "Bridge: shipped from Figma" (or "Bridge: token values, design approved") review, once per
//      head commit. GitHub refuses an app's
//      approval of a pull request the app opened (an email member's push): the review is then a comment, and when
//      the default branch requires an approval a developer gives it (code `needs_approval`);
//   5. enables auto-merge (squash first, as the repository allows): GitHub merges once the required checks pass.
//      When GitHub says the pull request can merge right now, Bridge merges it itself, only if every check finished
//      and passed. Never while a check runs.
//
// Env: GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY (the app needs Contents and Pull requests: Read and write, and Checks
// and Commit statuses: Read for step 5); the contribute env for email members (storage and LIBRARY_SESSION_SECRET).
// Without the app every call answers 200 armed false, code `app_missing`.

import { contributorOf, type ContribEnv } from '../contribute/index.js';
import { githubApp, type AppTokens } from '../_lib/github-app.js';
import { fail, GITHUB_DOWN, HttpError, json, parseRepo, readBody, sameOriginWhenPresent, type FetchLike } from '../_lib/http.js';
import {
  approverEntriesOf,
  designApprovalOf,
  FIGMA_SHIP_HEADING,
  figmaPushScope,
  figmaShipReviewBody,
  isClaudeDraft,
  isExploration,
  isFigmaPush,
  isTokenFile,
  shipConfig,
  tokenFileChanges,
  VALUES_SHIP_HEADING,
  valuesShipReviewBody,
  type ShipConfig,
  type TokenChange,
} from '../_lib/figma-ship.js';
import { figmaMark, figmaMarkKey, figmaMarkValid, withFigmaMark } from '../_lib/figma-mark.js';
import { localAdminsOn } from '../_lib/local-admin.js';
import { isLead, isTier1, leadsPublishTier1On, tier1Domain, tier1PublishReviewBody, TIER1_PUBLISH_HEADING } from '../_lib/tier1-publish.js';
import type { MemberStore } from '../_lib/members.js';
import type { Redis } from '../_lib/redis.js';

export type { FetchLike };

export interface ShipDeps {
  fetch: FetchLike;
  now?: () => number;
  /** Injected (tests, local mode); otherwise built from the env. */
  app?: AppTokens;
  /** Checks and statuses read token; defaults to `app`. */
  readApp?: AppTokens;
  redis?: Redis;
  members?: MemberStore;
}

export type ShipCode =
  | 'app_missing'
  | 'not_open'
  | 'not_default_branch'
  | 'not_from_figma'
  | 'exploration'
  | 'not_values'
  | 'needs_design_approval'
  | 'approval_outdated'
  | 'changes_requested'
  | 'too_many_files'
  | 'auto_merge_off'
  | 'needs_approval'
  | 'checks_failed'
  | 'checks_pending'
  | 'not_mergeable'
  | 'fork'
  // Marking a push from Figma (body `mark: "figma"`).
  | 'no_write'
  | 'mark_unavailable'
  // Tier 1 publish by leads (body `publish: "tier1"`, docs/GOVERNANCE.md "Tier 1 publish by leads").
  | 'not_author'
  | 'not_tier1'
  | 'publish_off'
  | 'not_lead'
  | 'publish_needs_github';

export interface ShipResult {
  armed: boolean;
  /** `review`: a Tier 1 publish Bridge could not arm; the change waits for a review like any other. */
  route: 'shipped' | 'waiting-for-developer' | 'review';
  /** Set when Bridge merged it on the spot (GitHub said it could merge now and every check had passed). */
  merged?: boolean;
  code?: ShipCode;
  /** One sentence for the designer, when not armed. Never a technical blocker. */
  reason?: string;
  /** The cause in developer words, when not armed: Studio shows it under "For developers" only. */
  developer?: string;
  /** checks_pending only: ask again after this many seconds. */
  retryAfter?: number;
}

/** The permissions of the token Bridge arms a merge with, and nothing more. */
export const SHIP_PERMISSIONS = { contents: 'write', pull_requests: 'write' } as const;
export const SHIP_READ_PERMISSIONS = { checks: 'read', statuses: 'read', pull_requests: 'read', contents: 'read' } as const;
const MAX_BODY = 2048;
const API = 'https://api.github.com';
const PR_NUMBER = /^[1-9]\d{0,9}$/;

// Designer words. A developer reads `code` and GitHub for the details.
const BY_DEVELOPER = 'A developer ships it from here.';
export const SHIP_WORDS: Record<ShipCode, string> = {
  app_missing: `Bridge cannot ship by itself on this library yet. ${BY_DEVELOPER}`,
  not_open: 'It is no longer open, so there is nothing to ship.',
  not_default_branch: `It does not go to the library directly. ${BY_DEVELOPER}`,
  not_from_figma: `Bridge only ships pushes from the Figma plugin by itself. ${BY_DEVELOPER}`,
  exploration: 'It is an exploration: it ships when the exploration is promoted.',
  not_values: `It changes more than token values, so a developer OKs it first.`,
  too_many_files: `It is too large for Bridge to check by itself. ${BY_DEVELOPER}`,
  auto_merge_off: `Bridge cannot ship by itself on this library yet. ${BY_DEVELOPER}`,
  needs_approval: `This library asks a developer to approve every change. ${BY_DEVELOPER}`,
  checks_failed: 'Something needs a developer before it ships. They are told on GitHub; nothing to do on your side.',
  checks_pending: 'The automatic checks are still running. Bridge ships it once they finish.',
  not_mergeable: 'Something needs a developer before it ships. They are told on GitHub; nothing to do on your side.',
  fork: `It comes from outside the team's library, so someone reviews it. ${BY_DEVELOPER}`,
  no_write: 'Your sign-in cannot change this library, so it ships once a design owner approves it.',
  mark_unavailable: `Bridge cannot ship by itself on this library yet. ${BY_DEVELOPER}`,
  needs_design_approval: 'It ships once a design owner approves it.',
  approval_outdated: 'It changed since it was approved: it ships once a design owner approves this version.',
  changes_requested: 'Changes were suggested: it ships once they are made and approved.',
  not_author: 'Only the person who made it can publish it.',
  not_tier1: 'It changes more than docs or guidance, so someone reviews it.',
  publish_off: 'Your team asks for a review on every change.',
  not_lead: 'Only admins and the reviewers of this part publish without review.',
  publish_needs_github: 'Publishing without review needs a GitHub sign-in for now.',
};

/** The cause, for the "For developers" fold of Studio and the API answer. Developer words are fine here. */
export const SHIP_DEVELOPER_WORDS: Record<ShipCode, string> = {
  app_missing: 'The Bridge GitHub App is not installed on this repository, or the server has no app keys (GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY), so Bridge cannot approve and arm the merge. Merge it by hand once the checks pass.',
  not_open: 'The pull request is closed or merged.',
  not_default_branch: 'The pull request does not target the default branch.',
  not_from_figma: 'The pull request is not labelled as a push from the Figma plugin.',
  exploration: 'The pull request is labelled exploration.',
  not_values: 'The pull request changes more than token values (a rename, a removal, code, a guardrail file, or token files Bridge could not read).',
  too_many_files: 'The pull request has 100 files or more; Bridge does not read past the first page.',
  auto_merge_off: 'Auto-merge is off on this repository (Settings, General, Allow auto-merge), so Bridge cannot arm the merge. Turn it on, or merge by hand once the checks pass.',
  needs_approval: 'The default branch requires an approving review that Bridge could not give (GitHub refuses an app approving a pull request it opened). Approve it and auto-merge ships it.',
  checks_failed: 'A required check failed on the head commit.',
  checks_pending: 'Checks are still running on the head commit; ask again once they finish.',
  not_mergeable: 'GitHub says it cannot merge: a conflict, a blocked status or a branch rule.',
  fork: 'The pull request comes from a fork. Bridge arms only pull requests whose branch lives in the repository itself.',
  no_write: 'The GitHub account that asked has no write access to the repository. Bridge records a push from Figma only for its author with write access.',
  mark_unavailable: 'The server has no LIBRARY_SESSION_SECRET (32 characters or more), so Bridge cannot sign the record of a push from Figma.',
  needs_design_approval: 'No design approver (governance.owners and rights in bridge.config.json on the default branch) approved it.',
  approval_outdated: 'The design approval was given on an older commit; it needs one on the head commit.',
  changes_requested: 'A reviewer requested changes and has not approved since.',
  not_author: 'The requester is not the author of the pull request; only the author publishes a Tier 1 change without review.',
  not_tier1: 'classifyRisk does not read Tier 1 for the changed files (code, a guardrail file, a token value, or token files Bridge could not read).',
  publish_off: 'governance.leadsPublishTier1 is false in bridge.config.json on the default branch.',
  not_lead: 'The author is neither a repository admin nor in the approver list of the domain (design for docs, tech for stories and tests) in bridge.config.json.',
  publish_needs_github: 'The request came from an email member session; Bridge publishes without review only for a GitHub-signed-in author (the app cannot approve a pull request it opened).',
};

/**
 * What the designer reads when a Tier 1 publish falls back to review: the cause when it is theirs to know, then that it
 * goes to review like any change. Never a failing test, a conflict or a GitHub setting.
 */
const TO_REVIEW = 'It goes to review like any change.';
export const PUBLISH_WORDS: Partial<Record<ShipCode, string>> = {
  not_author: `${SHIP_WORDS.not_author} ${TO_REVIEW}`,
  not_tier1: SHIP_WORDS.not_tier1,
  publish_off: `${SHIP_WORDS.publish_off} ${TO_REVIEW}`,
  not_lead: `${SHIP_WORDS.not_lead} ${TO_REVIEW}`,
  publish_needs_github: `${SHIP_WORDS.publish_needs_github} ${TO_REVIEW}`,
};
const publishWords = (code: ShipCode): string => PUBLISH_WORDS[code] ?? TO_REVIEW;

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '600', Vary: 'Origin' };
const SIGNIN = 'Sign in to Bridge first: with GitHub in the Figma plugin, or with your email in Studio.';

interface Gh {
  status: number;
  data: any;
}

function gh(f: FetchLike, token: string) {
  const call = async (method: string, path: string, body?: unknown, accept = 'application/vnd.github+json'): Promise<Gh> => {
    let res: Response;
    try {
      res = await f(`${API}${path}`, {
        method,
        headers: { Accept: accept, Authorization: `Bearer ${token}`, 'User-Agent': 'bridge-ship', 'X-GitHub-Api-Version': '2022-11-28', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
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
  const raw = async (owner: string, repo: string, path: string, ref: string): Promise<string | null> => {
    const r = await call('GET', `/repos/${owner}/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`, undefined, 'application/vnd.github.raw');
    if (r.status === 404) return null;
    if (r.status !== 200 || typeof r.data !== 'string') throw new HttpError(502, 'unreachable', GITHUB_DOWN);
    return r.data;
  };
  const graphql = async (query: string, variables: Record<string, unknown>): Promise<{ data: any; errors: string[] }> => {
    const r = await call('POST', '/graphql', { query, variables });
    const errors = Array.isArray(r.data?.errors) ? r.data.errors.map((e: any) => String(e?.message ?? '')) : r.status === 200 ? [] : [`GitHub answered ${r.status}`];
    return { data: r.data?.data ?? null, errors };
  };
  return { call, raw, graphql };
}

/**
 * The GitHub token of an `Authorization: Bearer` header, or null. Real GitHub tokens are 20 characters or more; only
 * local mode (BRIDGE_LOCAL=1, not on Vercel, not production) accepts the short ones of the local personas (ghp_local_dana).
 */
export function bearerToken(header: string | null, processEnv: Record<string, string | undefined> = process.env): string | null {
  const m = /^Bearer\s+([A-Za-z0-9_.-]{1,255})$/i.exec(header ?? '')?.[1];
  if (!m) return null;
  return m.length >= (localAdminsOn(processEnv) ? 8 : 20) ? m : null;
}

/** Who asks: a GitHub token (and whether it may write to the repository), or an email member signed in to Studio. */
export type Caller = { kind: 'bearer'; token: string; push: boolean } | { kind: 'member' };

/** Who asks: a GitHub token that can read the repository, or an email member of the team signed in to Studio. */
async function allowed(req: Request, owner: string, repo: string, full: string, env: ContribEnv, deps: ShipDeps): Promise<Caller | null> {
  const bearer = bearerToken(req.headers.get('authorization'));
  if (bearer) {
    const r = await gh(deps.fetch, bearer).call('GET', `/repos/${owner}/${repo}`);
    return r.status === 200 && r.data?.permissions?.pull ? { kind: 'bearer', token: bearer, push: r.data.permissions.push === true } : null;
  }
  if (req.headers.get('x-bridge-contribute') !== '1' || !sameOriginWhenPresent(req)) throw new HttpError(403, 'origin', 'Ship from Studio on this site, or from the Figma plugin.');
  const m = await contributorOf(req, full, env, { fetch: deps.fetch, ...(deps.now ? { now: deps.now } : {}), ...(deps.redis ? { redis: deps.redis } : {}), ...(deps.members ? { members: deps.members } : {}), ...(deps.app ? { app: deps.app } : {}) });
  return m ? { kind: 'member' } : null;
}

const lowerLogin = (x: unknown) => String(x ?? '').trim().replace(/^@/, '').toLowerCase();

/** The branch of the pull request lives in the repository itself: a fork's head (or a deleted one) never ships here. */
export function sameRepository(pr: any, owner: string, repo: string): boolean {
  const head = pr?.head?.repo?.full_name;
  const base = pr?.base?.repo?.full_name ?? `${owner}/${repo}`;
  return typeof head === 'string' && head.toLowerCase() === String(base).toLowerCase();
}

const notArmed = (code: ShipCode, extra: Partial<ShipResult> = {}): ShipResult => ({ armed: false, route: 'waiting-for-developer', code, reason: SHIP_WORDS[code], developer: SHIP_DEVELOPER_WORDS[code], ...extra });
/** A Tier 1 publish Bridge does not arm: the change goes to review, in designer words. */
const toReview = (code: ShipCode, extra: Partial<ShipResult> = {}): ShipResult => ({ ...notArmed(code, extra), route: 'review', reason: publishWords(code) });

/** A team entry ("@org/slug") of the design list counts the approvers who are active members of it, when the app can read it. */
async function withTeamMembers(call: ReturnType<typeof gh>['call'], design: string[], approvers: string[]): Promise<string[]> {
  const out = design.filter((x) => !x.includes('/'));
  for (const team of design.filter((x) => x.includes('/'))) {
    const [org, slug] = team.replace(/^@/, '').split('/');
    if (!org || !slug) continue;
    for (const login of approvers) {
      if (out.some((x) => x.toLowerCase().replace(/^@/, '') === login.toLowerCase())) continue;
      const m = await call('GET', `/orgs/${encodeURIComponent(org)}/teams/${encodeURIComponent(slug)}/memberships/${encodeURIComponent(login)}`).catch(() => null);
      if (m?.status === 200 && m.data?.state === 'active') out.push(login);
    }
  }
  // Every design entry a team nobody could be read in: keep the team, so the list never turns empty (no login matches it).
  return out.length ? out : design;
}

const MERGE_METHODS = [
  ['allow_squash_merge', 'squash', 'SQUASH'],
  ['allow_merge_commit', 'merge', 'MERGE'],
  ['allow_rebase_merge', 'rebase', 'REBASE'],
] as const;

/** Checks and statuses of a commit: 'pass', 'fail' or 'pending' (core summarizeCi, the parts needed here). */
async function ciState(call: ReturnType<typeof gh>['call'], owner: string, repo: string, sha: string): Promise<'pass' | 'fail' | 'pending'> {
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

type PrFile = { path: string; status: string; previous: string | null };

/** The token changes of the pull request: each token file at the merge base and at the head. Null when unreadable. */
async function readTokenChanges(call: ReturnType<typeof gh>['call'], raw: ReturnType<typeof gh>['raw'], owner: string, repo: string, pr: any, files: PrFile[], config: ShipConfig): Promise<TokenChange[] | null> {
  const tokenFiles = files.filter((x) => isTokenFile(x.path, config) || (x.previous && isTokenFile(x.previous, config)));
  if (!tokenFiles.length) return [];
  const cmp = await call('GET', `/repos/${owner}/${repo}/compare/${pr.base.sha}...${pr.head.sha}`);
  const mergeBase = cmp.status === 200 ? cmp.data?.merge_base_commit?.sha : null;
  if (!mergeBase) throw new HttpError(502, 'unreachable', GITHUB_DOWN);
  const texts = await Promise.all(
    tokenFiles.map(async (x) => ({
      before: x.status === 'added' ? null : await raw(owner, repo, x.previous ?? x.path, mergeBase),
      after: x.status === 'removed' ? null : await raw(owner, repo, x.path, pr.head.sha),
    })),
  );
  try {
    return tokenFileChanges(texts);
  } catch {
    return null;
  }
}

/** bridge.config.json on the default branch, as parsed JSON; null when absent or unreadable. */
async function readConfig(raw: ReturnType<typeof gh>['raw'], owner: string, repo: string, ref: string): Promise<unknown> {
  try {
    const text = await raw(owner, repo, 'bridge.config.json', ref);
    return text ? JSON.parse(text) : null;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    return null;
  }
}

/** The repository and the pull request, read with the app token. */
async function readPull(call: ReturnType<typeof gh>['call'], owner: string, repo: string, n: number): Promise<{ r: any; pr: any }> {
  const base = `/repos/${owner}/${repo}`;
  const [repoR, prR] = await Promise.all([call('GET', base), call('GET', `${base}/pulls/${n}`)]);
  if (prR.status === 404) throw new HttpError(404, 'not_found', `There is no pull request #${n} on ${owner}/${repo}.`);
  if (repoR.status !== 200 || prR.status !== 200) throw new HttpError(502, 'unreachable', GITHUB_DOWN);
  return { r: repoR.data, pr: prR.data };
}

/** What the pull request changes at its head, read from GitHub: null when token values only, else why not. */
async function valuesScope(call: ReturnType<typeof gh>['call'], raw: ReturnType<typeof gh>['raw'], owner: string, repo: string, n: number, r: any, pr: any): Promise<{ code: ShipCode | null; rawConfig: unknown }> {
  const filesR = await call('GET', `/repos/${owner}/${repo}/pulls/${n}/files?per_page=100`);
  if (filesR.status !== 200 || !Array.isArray(filesR.data)) throw new HttpError(502, 'unreachable', GITHUB_DOWN);
  if (filesR.data.length >= 100 || (typeof pr.changed_files === 'number' && pr.changed_files > filesR.data.length)) return { code: 'too_many_files', rawConfig: null };
  const rawConfig = await readConfig(raw, owner, repo, r.default_branch);
  const config: ShipConfig = shipConfig(rawConfig);
  const files: PrFile[] = filesR.data.map((x: any) => ({ path: String(x.filename), status: String(x.status), previous: typeof x.previous_filename === 'string' ? x.previous_filename : null }));
  const changes = await readTokenChanges(call, raw, owner, repo, pr, files, config);
  return { code: figmaPushScope(files, changes, config) === 'token-values' ? null : 'not_values', rawConfig };
}

/**
 * Whether a pull request labelled as a push from Figma is one: handleShip checks that the caller is its author, with
 * write access, and that its body holds Bridge's mark for its current head (api/_lib/figma-mark.ts).
 */
export type FigmaCheck = (pr: any) => Promise<boolean>;
const NOT_FIGMA: FigmaCheck = async () => false;

/** The ship itself, once the caller is allowed. Without `verified`, nothing counts as a push from Figma. Exported for tests. */
export async function armShip(f: FetchLike, token: string, readToken: string | null, owner: string, repo: string, n: number, verified: FigmaCheck = NOT_FIGMA): Promise<ShipResult> {
  const { call, raw } = gh(f, token);
  const base = `/repos/${owner}/${repo}`;
  const { r, pr } = await readPull(call, owner, repo, n);
  if (pr.state !== 'open' || pr.merged_at) return notArmed('not_open');
  if (pr.base?.ref !== r.default_branch) return notArmed('not_default_branch');
  if (!sameRepository(pr, owner, repo)) return notArmed('fork');
  if (isExploration(pr.labels)) return notArmed('exploration');
  const claimed = isFigmaPush({ labels: pr.labels, body: pr.body });
  if (isClaudeDraft({ labels: pr.labels, body: pr.body })) return notArmed('not_values');

  // What it changes, read from GitHub: the files, then each token file at the merge base and at the head.
  const { code, rawConfig } = await valuesScope(call, raw, owner, repo, n, r, pr);
  if (code) return notArmed(code);

  // A label or a block only claims Figma: it counts once verified, else the change follows the TV-1 rule below.
  const figma = claimed && (await verified(pr));

  // Not a push from Figma (decision TV-1): the design approval, read from GitHub, on the head commit. Nothing is written
  // before it is in, nor when the repository cannot auto-merge.
  let designers: string[] = [];
  let reviewList: any[] | null = null;
  if (figma) {
    // The push is design-approved by its author, but a reviewer's change request still holds it.
    const rv = await call('GET', `${base}/pulls/${n}/reviews?per_page=100`);
    if (rv.status !== 200 || !Array.isArray(rv.data)) throw new HttpError(502, 'unreachable', GITHUB_DOWN);
    reviewList = rv.data;
    const people = rv.data.filter((x: any) => x?.user?.type !== 'Bot');
    if (designApprovalOf(people, approverEntriesOf(rawConfig), pr.user?.login, pr.head.sha).changesRequested.length) return notArmed('changes_requested');
  } else {
    if (r.allow_auto_merge === false || !MERGE_METHODS.some(([k]) => r[k] !== false)) return notArmed('auto_merge_off');
    const rv = await call('GET', `${base}/pulls/${n}/reviews?per_page=100`);
    if (rv.status !== 200 || !Array.isArray(rv.data)) throw new HttpError(502, 'unreachable', GITHUB_DOWN);
    reviewList = rv.data;
    // People only: Bridge's own reviews never count as an approval of the look.
    const people = rv.data.filter((x: any) => x?.user?.type !== 'Bot');
    const lists = approverEntriesOf(rawConfig);
    const first = designApprovalOf(people, lists, pr.user?.login, pr.head.sha);
    const owners = lists.design.some((x) => x.includes('/')) ? { ...lists, design: await withTeamMembers(call, lists.design, first.approvers) } : lists;
    const v = owners === lists ? first : designApprovalOf(people, owners, pr.user?.login, pr.head.sha);
    if (v.changesRequested.length) return notArmed('changes_requested');
    if (!v.design) return notArmed('needs_design_approval');
    if (!v.atHead.length) return notArmed('approval_outdated');
    designers = v.atHead;
  }

  const heading = figma ? FIGMA_SHIP_HEADING : VALUES_SHIP_HEADING;
  const body = figma ? figmaShipReviewBody(pr.user?.type === 'Bot' ? null : pr.user?.login) : valuesShipReviewBody(designers);
  return approveAndArm({ f, token, readToken, owner, repo, n, r, pr, heading, body, counted: designers.length, reviewList, notArmed });
}

/** What a mark call answers. */
export interface MarkResult {
  marked: boolean;
  code?: ShipCode;
  reason?: string;
  developer?: string;
}
const notMarked = (code: ShipCode): MarkResult => ({ marked: false, code, reason: SHIP_WORDS[code], developer: SHIP_DEVELOPER_WORDS[code] });

/**
 * Bridge records a push from Figma (api/_lib/figma-mark.ts): the caller is its author with write access; it is open, to
 * the default branch, from the repository itself, labelled as a push from Figma, and token values only at its head.
 * Bridge then writes its signed mark for that head into the body, with the app token. Exported for tests.
 */
export async function markFigmaPush(f: FetchLike, token: string, owner: string, repo: string, n: number, who: { login: string; push: boolean }, key: Buffer | null): Promise<MarkResult> {
  if (!key) return notMarked('mark_unavailable');
  if (!who.push) return notMarked('no_write');
  const { call, raw } = gh(f, token);
  const { r, pr } = await readPull(call, owner, repo, n);
  if (pr.state !== 'open' || pr.merged_at) return notMarked('not_open');
  if (pr.base?.ref !== r.default_branch) return notMarked('not_default_branch');
  if (!sameRepository(pr, owner, repo)) return notMarked('fork');
  if (pr.user?.type === 'Bot' || !who.login || lowerLogin(pr.user?.login) !== lowerLogin(who.login)) return notMarked('not_author');
  if (isExploration(pr.labels)) return notMarked('exploration');
  if (!isFigmaPush({ labels: pr.labels, body: pr.body })) return notMarked('not_from_figma');
  if (isClaudeDraft({ labels: pr.labels, body: pr.body })) return notMarked('not_values');
  const { code } = await valuesScope(call, raw, owner, repo, n, r, pr);
  if (code) return notMarked(code);
  const mark = figmaMark(key, { repo: `${owner}/${repo}`, pr: n, sha: String(pr.head.sha), author: String(pr.user.login) });
  const w = await call('PATCH', `/repos/${owner}/${repo}/pulls/${n}`, { body: withFigmaMark(pr.body, mark) });
  if (w.status !== 200) throw new HttpError(502, 'unreachable', GITHUB_DOWN);
  return { marked: true };
}

interface ArmInput {
  f: FetchLike;
  token: string;
  readToken: string | null;
  owner: string;
  repo: string;
  n: number;
  /** The repository and the pull request as GitHub answered them. */
  r: any;
  pr: any;
  /** The first line of Bridge's review, and the review itself (once per head commit). */
  heading: string;
  body: string;
  /** People's approvals on the head that already count toward what the branch requires. */
  counted: number;
  reviewList: any[] | null;
  /** How a not-armed answer reads on this route. */
  notArmed: (code: ShipCode, extra?: Partial<ShipResult>) => ShipResult;
}

/**
 * Ready for review, Bridge's approving review (a comment when GitHub refuses the app's approval), then auto-merge;
 * merged on the spot only when GitHub can merge now and every check passed. Shared by the values and Tier 1 routes.
 */
async function approveAndArm(a: ArmInput): Promise<ShipResult> {
  const { f, token, readToken, owner, repo, n, r, pr, heading, body, counted, reviewList, notArmed } = a;
  const { call, graphql } = gh(f, token);
  const base = `/repos/${owner}/${repo}`;
  // Auto-merge in the first merge method the repository allows (squash first). Off in the repository: an error.
  const enableAutoMerge = async (): Promise<{ errors: string[] }> => {
    const m = MERGE_METHODS.find(([k]) => r[k] !== false);
    if (!m || r.allow_auto_merge === false) return { errors: ['auto-merge is not allowed for this repository'] };
    return graphql('mutation($id: ID!, $m: PullRequestMergeMethod!, $oid: GitObjectID) { enablePullRequestAutoMerge(input: { pullRequestId: $id, mergeMethod: $m, expectedHeadOid: $oid }) { pullRequest { number } } }', {
      id: pr.node_id,
      m: m[2],
      oid: pr.head.sha,
    });
  };

  // Ready for review, then the review that records the rule (once per head commit).
  if (pr.draft) {
    const g = await graphql('mutation($id: ID!) { markPullRequestReadyForReview(input: { pullRequestId: $id }) { pullRequest { isDraft } } }', { id: pr.node_id });
    if (g.errors.length) throw new HttpError(502, 'unreachable', GITHUB_DOWN);
  }
  const reviews = reviewList ? { data: reviewList } : await call('GET', `${base}/pulls/${n}/reviews?per_page=100`);
  const ours = (reviews.data ?? []).filter((x: any) => typeof x.body === 'string' && x.body.startsWith(heading) && x.commit_id === pr.head.sha && x.user?.type === 'Bot');
  let approved = ours.some((x: any) => x.state === 'APPROVED');
  if (!ours.length) {
    const a = await call('POST', `${base}/pulls/${n}/reviews`, { event: 'APPROVE', body, commit_id: pr.head.sha });
    approved = a.status === 200;
    // GitHub refuses an app's approval of a pull request the app opened: the record stays, as a comment.
    if (!approved) await call('POST', `${base}/pulls/${n}/reviews`, { event: 'COMMENT', body, commit_id: pr.head.sha });
  }
  if (!approved) {
    const rules = await call('GET', `${base}/rules/branches/${encodeURIComponent(r.default_branch)}`);
    // The design approvals on the head already count toward what the branch requires.
    const needs = Array.isArray(rules.data) && rules.data.some((x: any) => x?.type === 'pull_request' && Number(x.parameters?.required_approving_review_count ?? 0) > counted);
    if (needs) {
      // Auto-merge still goes on where it can: a developer's approval then ships it with no second step.
      await enableAutoMerge();
      return notArmed('needs_approval');
    }
  }

  const method = MERGE_METHODS.find(([k]) => r[k] !== false);
  if (!method) return notArmed('auto_merge_off');
  const g = await enableAutoMerge();
  if (!g.errors.length) return { armed: true, route: 'shipped' };
  const why = g.errors.join(' ').toLowerCase();
  // GitHub enables auto-merge only while something is still pending: "clean status" means it can merge right now.
  if (/clean status|is in clean|already mergeable/.test(why)) {
    const ci = await ciState(gh(f, readToken ?? token).call, owner, repo, pr.head.sha);
    if (ci === 'fail') return notArmed('checks_failed');
    if (ci === 'pending') return notArmed('checks_pending', { retryAfter: 60 });
    const merge = await call('PUT', `${base}/pulls/${n}/merge`, { merge_method: method[1], sha: pr.head.sha });
    if (merge.status === 200 && merge.data?.merged !== false) return { armed: true, route: 'shipped', merged: true };
    return notArmed('not_mergeable');
  }
  if (/auto.?merge|not allowed|not enabled/.test(why) || r.allow_auto_merge === false) return notArmed('auto_merge_off');
  if (/conflict|unstable|blocked|not mergeable/.test(why)) return notArmed('not_mergeable');
  throw new HttpError(502, 'unreachable', GITHUB_DOWN);
}

/** Who publishes: the GitHub account of the Bearer token, read with that token. */
export interface Publisher {
  login: string;
  /** The GitHub profile name, else the login. */
  name: string;
}

/**
 * Tier 1 publish by leads (docs/GOVERNANCE.md "Tier 1 publish by leads"): the author of a Tier 1 change, a repository
 * admin or in the approver list of its domain, publishes it without review. Bridge approves it with the record
 * "Published by <name> without review (Tier 1)." and arms auto-merge, so it merges once the checks pass. Anything that
 * stops it answers `route: "review"`: the change waits for a review like any other. Exported for tests.
 */
export async function armPublish(f: FetchLike, token: string, readToken: string | null, owner: string, repo: string, n: number, who: Publisher): Promise<ShipResult> {
  const { call, raw } = gh(f, token);
  const base = `/repos/${owner}/${repo}`;
  const [repoR, prR] = await Promise.all([call('GET', base), call('GET', `${base}/pulls/${n}`)]);
  if (prR.status === 404) throw new HttpError(404, 'not_found', `There is no pull request #${n} on ${owner}/${repo}.`);
  if (repoR.status !== 200 || prR.status !== 200) throw new HttpError(502, 'unreachable', GITHUB_DOWN);
  const r = repoR.data;
  const pr = prR.data;
  if (pr.state !== 'open' || pr.merged_at) return toReview('not_open');
  if (pr.base?.ref !== r.default_branch) return toReview('not_default_branch');
  if (!sameRepository(pr, owner, repo)) return toReview('fork');
  if (isExploration(pr.labels)) return toReview('exploration');
  const lower = (x: string) => x.trim().replace(/^@/, '').toLowerCase();
  if (pr.user?.type === 'Bot' || lower(String(pr.user?.login ?? '')) !== lower(who.login)) return toReview('not_author');

  const filesR = await call('GET', `${base}/pulls/${n}/files?per_page=100`);
  if (filesR.status !== 200 || !Array.isArray(filesR.data)) throw new HttpError(502, 'unreachable', GITHUB_DOWN);
  if (filesR.data.length >= 100 || (typeof pr.changed_files === 'number' && pr.changed_files > filesR.data.length)) return toReview('too_many_files');
  const rawConfig = await readConfig(raw, owner, repo, r.default_branch);
  const config = shipConfig(rawConfig);
  const files: PrFile[] = filesR.data.map((x: any) => ({ path: String(x.filename), status: String(x.status), previous: typeof x.previous_filename === 'string' ? x.previous_filename : null }));
  // A rename counts its old path too: moving a component's source into docs is not docs.
  const paths = files.flatMap((x) => (x.previous ? [x.path, x.previous] : [x.path]));
  const changes = await readTokenChanges(call, raw, owner, repo, pr, files, config);
  if (!isTier1(paths.map((path) => ({ path })), changes, config)) return toReview('not_tier1');
  if (!leadsPublishTier1On(rawConfig)) return toReview('publish_off');

  // A lead: an admin of the repository on GitHub (read by the app), or in the approver list of the change's domain.
  const perm = await call('GET', `${base}/collaborators/${encodeURIComponent(who.login)}/permission`);
  const admin = perm.status === 200 && perm.data?.permission === 'admin';
  const domain = tier1Domain(paths);
  const listed = approverEntriesOf(rawConfig)[domain];
  const approvers = admin || !listed.some((x) => x.includes('/')) ? listed : await withTeamMembers(call, listed, [who.login]);
  if (!isLead(who.login, { admin, approvers })) return toReview('not_lead');

  if (r.allow_auto_merge === false || !MERGE_METHODS.some(([k]) => r[k] !== false)) return toReview('auto_merge_off');
  // A check that already failed: nothing is written, it goes to review. The designer never reads which one.
  if ((await ciState(gh(f, readToken ?? token).call, owner, repo, pr.head.sha)) === 'fail') return toReview('checks_failed');
  return approveAndArm({ f, token, readToken, owner, repo, n, r, pr, heading: TIER1_PUBLISH_HEADING, body: tier1PublishReviewBody(who.name, who.login), counted: 0, reviewList: null, notArmed: toReview });
}

export async function handleShip(req: Request, env: ContribEnv, deps: ShipDeps): Promise<Response> {
  const bearerCall = /^Bearer\s/i.test(req.headers.get('authorization') ?? '');
  const cors = (r: Response) => {
    if (!bearerCall && req.method !== 'OPTIONS') return r;
    for (const [k, v] of Object.entries(CORS)) r.headers.set(k, v);
    return r;
  };
  try {
    if (req.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));
    if (req.method !== 'POST') return cors(fail(405, 'method', 'Send a POST.'));
    if (!/^application\/json\b/i.test(req.headers.get('content-type') ?? '')) return cors(fail(415, 'content_type', 'Send JSON.'));
    const body = await readBody(req, MAX_BODY);
    const { owner, repo, full } = parseRepo(body.repo);
    if (!PR_NUMBER.test(String(body.pr ?? ''))) return cors(fail(400, 'bad_request', 'Say which pull request, as its number.'));
    const n = Number(body.pr);
    const now = deps.now ?? Date.now;
    const appId = env.GITHUB_APP_ID?.trim();
    const pem = env.GITHUB_APP_PRIVATE_KEY?.trim();
    const app = deps.app ?? (appId && pem ? githubApp(appId, pem, deps.fetch, now, { permissions: { ...SHIP_PERMISSIONS }, require: { ...SHIP_PERMISSIONS }, userAgent: 'bridge-ship' }) : null);
    if (body.publish !== undefined && body.publish !== 'tier1') return cors(fail(400, 'bad_request', 'Say what to publish: "tier1", or leave it out.'));
    const publish = body.publish === 'tier1';
    if (body.mark !== undefined && body.mark !== 'figma') return cors(fail(400, 'bad_request', 'Say what to mark: "figma", or leave it out.'));
    const mark = body.mark === 'figma';
    if (mark && publish) return cors(fail(400, 'bad_request', 'Mark or publish, not both.'));
    const who = await allowed(req, owner, repo, full, env, { ...deps, ...(app ? { app } : {}) });
    if (!who) return cors(fail(401, 'signin', SIGNIN));
    if (mark && who.kind !== 'bearer') return cors(fail(403, 'github', 'Marking a push from Figma needs a GitHub sign-in.'));
    // The GitHub account of the token, read with that token, once and only when needed.
    let me: Promise<Publisher | null> | null = null;
    const account = (): Promise<Publisher | null> => {
      if (who.kind !== 'bearer') return Promise.resolve(null);
      me ??= gh(deps.fetch, who.token)
        .call('GET', '/user')
        .then((u) => (u.status === 200 && typeof u.data?.login === 'string' ? { login: u.data.login, name: typeof u.data.name === 'string' && u.data.name.trim() ? u.data.name.trim() : u.data.login } : null));
      return me;
    };
    // Publishing names a person: the GitHub account of the token. An email member's change goes to review.
    let publisher: Publisher | null = null;
    if (publish) {
      if (who.kind !== 'bearer') return cors(json(200, toReview('publish_needs_github')));
      publisher = await account();
      if (!publisher) return cors(fail(401, 'signin', SIGNIN));
    }
    const key = figmaMarkKey(env.LIBRARY_SESSION_SECRET);
    if (mark) {
      const caller = await account();
      if (!caller) return cors(fail(401, 'signin', SIGNIN));
      const token = app ? await app.installationToken(owner, repo) : null;
      if (!token) return cors(json(200, notMarked('app_missing')));
      return cors(json(200, await markFigmaPush(deps.fetch, token, owner, repo, n, { login: caller.login, push: who.kind === 'bearer' && who.push }, key)));
    }
    const token = app ? await app.installationToken(owner, repo) : null;
    if (!token) return cors(json(200, publish ? toReview('app_missing') : notArmed('app_missing')));
    const readApp = deps.readApp ?? deps.app ?? (appId && pem ? githubApp(appId, pem, deps.fetch, now, { permissions: { ...SHIP_READ_PERMISSIONS }, require: { ...SHIP_READ_PERMISSIONS }, userAgent: 'bridge-ship' }) : null);
    const readToken = readApp ? await readApp.installationToken(owner, repo).catch(() => null) : null;
    // A push from Figma counts only for its author with write access, with Bridge's mark for its current head.
    const verified: FigmaCheck = async (pr) => {
      if (who.kind !== 'bearer' || !who.push || pr?.user?.type === 'Bot') return false;
      const caller = await account();
      if (!caller || lowerLogin(caller.login) !== lowerLogin(pr?.user?.login)) return false;
      return figmaMarkValid(pr.body, key, { repo: `${owner}/${repo}`, pr: n, sha: String(pr?.head?.sha ?? ''), author: String(pr.user.login) });
    };
    return cors(json(200, publisher ? await armPublish(deps.fetch, token, readToken, owner, repo, n, publisher) : await armShip(deps.fetch, token, readToken, owner, repo, n, verified)));
  } catch (e) {
    if (e instanceof HttpError) return cors(json(e.status, { error: e.code, message: e.message, ...e.extra }, e.headers));
    return cors(fail(502, 'unreachable', GITHUB_DOWN));
  }
}

const envFromProcess = (): ContribEnv => ({
  KV_REST_API_URL: process.env.KV_REST_API_URL,
  KV_REST_API_TOKEN: process.env.KV_REST_API_TOKEN,
  UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
  UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
  LIBRARY_SESSION_SECRET: process.env.LIBRARY_SESSION_SECRET,
  GITHUB_APP_ID: process.env.GITHUB_APP_ID,
  GITHUB_APP_PRIVATE_KEY: process.env.GITHUB_APP_PRIVATE_KEY,
});

const realFetch: FetchLike = (url, init) => fetch(url, init);
const handle = (request: Request) => handleShip(request, envFromProcess(), { fetch: realFetch });

/** Vercel Functions entries (Web standard signature). */
export const POST = handle;
export const OPTIONS = handle;
