// Screenshots of private products' explorations, kept by Bridge (the public preview-shots workflow captures only public
// repositories, into a branch anyone can read). The design team's copy of a product is usually private, so its
// explorations had no screenshot on their cards. Here:
//   - Bridge's own workflow (.github/workflows/private-shots.yml in Bridge's repository, scripts/private-shots.mjs)
//     asks GET /api/contribute?shots=todo which explorations of the watched design copies need a capture: their
//     repository, number, head commit, branch and preview template. It captures each preview and sends it back with
//     POST /api/contribute?shots=put. Both calls carry the workflow's GitHub OIDC token (no stored secret): issued by
//     GitHub Actions, for audience AUDIENCE, from Bridge's repository on its default branch (SHOTS_REPOSITORY).
//   - Captures are kept in Redis, bridge:shot:<repo>#<pr> { sha, capturedAt, url, image (base64 webp) }, KEEP_S.
//   - Studio reads GET ?repo=<team>&shot=<owner/repo>&pr=<n>&meta=1 (when it was taken, of which commit) and the image
//     without meta=1: only for a reader of the team (a member, or a visitor of a demo team), only for a product
//     repository the team's config lists (team-read productReadAllowed), never kept by a shared cache.
import { createPublicKey, createVerify } from 'node:crypto';
import { HttpError, json, SECURITY_HEADERS, type FetchLike } from './http.js';
import type { Redis } from './redis.js';
import { NOTIFY_TEAMS_KEY, repoMetaKey } from './notify.js';

export const AUDIENCE = 'bridge-shots';
export const SHOTS_REPOSITORY = 'the-bridge-company/ai-design-system-demo';
export const ISSUER = 'https://token.actions.githubusercontent.com';
export const KEEP_S = 90 * 24 * 3600;
/** At most this many explorations per todo answer (a run captures them in a few minutes). */
export const TODO_MAX = 20;
/** A capture larger than this (base64 characters) is refused: 800 px wide webp stays far under. */
export const MAX_IMAGE_CHARS = 400_000;
const API = 'https://api.github.com';
const REPO = /^[\w.-]+\/[\w.-]+$/;
const SHA = /^[0-9a-f]{40}$/;

export const shotKeyOf = (repo: string, pr: number) => `bridge:shot:${repo.toLowerCase()}#${pr}`;

export interface ShotsCtx {
  f: FetchLike;
  now: () => number;
  redis: Redis;
  /** An installation token of the Bridge app on that repository, or null. */
  token: (owner: string, repo: string) => Promise<string | null>;
}

// --- The workflow's identity: GitHub's OIDC token --------------------------------------------------------------------

interface Jwk {
  kid?: string;
  kty?: string;
  n?: string;
  e?: string;
}
let jwks: { at: number; keys: Jwk[] } | null = null;

const b64urlJson = (part: string): any => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

/**
 * The claims of a GitHub Actions OIDC token when it verifies (RS256 with GitHub's published keys, issuer, audience,
 * not expired) and was issued to Bridge's own repository on its default branch; null otherwise.
 */
export async function workflowClaims(ctx: Pick<ShotsCtx, 'f' | 'now'>, authorization: string | null, repository = SHOTS_REPOSITORY): Promise<Record<string, unknown> | null> {
  const token = /^Bearer\s+([\w-]+\.[\w-]+\.[\w-]+)$/.exec(authorization ?? '')?.[1];
  if (!token) return null;
  const [h, p, sig] = token.split('.') as [string, string, string];
  let header: { alg?: string; kid?: string };
  let claims: Record<string, unknown>;
  try {
    header = b64urlJson(h);
    claims = b64urlJson(p);
  } catch {
    return null;
  }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') return null;
  if (!jwks || ctx.now() - jwks.at > 3600_000 || !jwks.keys.some((k) => k.kid === header.kid)) {
    try {
      const res = await ctx.f(`${ISSUER}/.well-known/jwks`, { method: 'GET', headers: { Accept: 'application/json' } });
      if (res.status !== 200) return null;
      jwks = { at: ctx.now(), keys: ((await res.json()) as { keys?: Jwk[] }).keys ?? [] };
    } catch {
      return null;
    }
  }
  const jwk = jwks.keys.find((k) => k.kid === header.kid && k.kty === 'RSA');
  if (!jwk) return null;
  let ok = false;
  try {
    const key = createPublicKey({ key: { kty: 'RSA', n: jwk.n!, e: jwk.e! }, format: 'jwk' });
    ok = createVerify('RSA-SHA256').update(`${h}.${p}`).verify(key, Buffer.from(sig, 'base64url'));
  } catch {
    ok = false;
  }
  if (!ok) return null;
  const now = Math.floor(ctx.now() / 1000);
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== ISSUER || !aud.includes(AUDIENCE) || typeof claims.exp !== 'number' || claims.exp < now) return null;
  if (String(claims.repository ?? '').toLowerCase() !== repository.toLowerCase()) return null;
  if (claims.ref !== 'refs/heads/main') return null;
  return claims;
}

/** Test seam: forget GitHub's keys. */
export const clearJwks = () => {
  jwks = null;
};

// --- What needs a capture ----------------------------------------------------------------------------------------------

export interface ShotJob {
  repo: string;
  pr: number;
  sha: string;
  branch: string;
  /** The copy's preview template (products[].design.preview), filled by the workflow with @bridge-ds/core previewUrl. */
  template: string;
  /** The changed files' names ("billing" for src/pages/Billing.tsx): the page to open when no change marker shows one. */
  hints: string[];
}

/** Names worth looking for among a preview's links: the changed files' base names, never the app shell's. */
export function fileHints(files: readonly string[]): string[] {
  const shell = new Set(['index', 'app', 'main', 'styles', 'style', 'theme', 'tokens', 'readme', 'package', 'vite.config', 'tsconfig']);
  const out: string[] = [];
  // Folders that say nothing about the page (src/resources/orders/OrderList.tsx names "orders", never "resources").
  const plain = new Set(['src', 'app', 'apps', 'lib', 'ui', 'components', 'resources', 'pages', 'views', 'routes', 'screens', 'features', 'modules', 'shared', 'common']);
  // Words of a file name that name no page on their own ("list" in OrderList).
  const generic = new Set(['list', 'page', 'view', 'item', 'items', 'form', 'card', 'table', 'show', 'edit', 'create', 'panel', 'row', 'cell', 'header', 'footer', 'layout']);
  const add = (w: string) => {
    if (w.length >= 3 && !shell.has(w) && !generic.has(w) && !out.includes(w)) out.push(w);
  };
  for (const f of files) {
    if (f.startsWith('.') || f.includes('/.')) continue;
    const parts = f.split('/');
    const file = parts.pop()!.replace(/\.(tsx?|jsx?|vue|svelte|css|md|json)$/i, '');
    const base = file.toLowerCase();
    if (base.length < 3 || shell.has(base)) continue;
    // The whole name first (billing), then its folder (orders), then the words of a compound name (order in OrderList).
    if (!out.includes(base)) out.push(base);
    const dir = parts.pop()?.toLowerCase();
    if (dir && !plain.has(dir)) add(dir);
    for (const w of file.split(/(?<=[a-z0-9])(?=[A-Z])|[-_.\s]+/)) add(w.toLowerCase());
  }
  return out.slice(0, 8);
}

async function gh(ctx: ShotsCtx, token: string, path: string, accept = 'application/vnd.github+json'): Promise<Response | null> {
  try {
    return await ctx.f(`${API}${path}`, { method: 'GET', headers: { Accept: accept, Authorization: `Bearer ${token}`, 'User-Agent': 'bridge-shots', 'X-GitHub-Api-Version': '2022-11-28' } });
  } catch {
    return null;
  }
}

/** The design copies Bridge watches (api/_lib/notify.ts), each with its team. */
async function watchedCopies(redis: Redis): Promise<{ repo: string; team: string }[]> {
  const repos = ((await redis.cmd('SMEMBERS', NOTIFY_TEAMS_KEY)) as string[] | null) ?? [];
  const metas = repos.length ? ((await redis.pipe(repos.map((r) => ['GET', repoMetaKey(r)]))) as (string | null)[]) : [];
  const out: { repo: string; team: string }[] = [];
  repos.forEach((repo, i) => {
    try {
      const m = metas[i] ? JSON.parse(metas[i]!) : null;
      if (m?.kind === 'copy' && typeof m.team === 'string' && REPO.test(repo)) out.push({ repo: repo.toLowerCase(), team: m.team.toLowerCase() });
    } catch {
      /* a broken entry: skipped */
    }
  });
  return out;
}

/** The copy's preview template from its team's bridge.config.json (products[].design.preview), or null. */
async function copyTemplate(ctx: ShotsCtx, team: string, copy: string): Promise<string | null> {
  const [o, r] = team.split('/') as [string, string];
  if (!REPO.test(team)) return null;
  const token = await ctx.token(o, r);
  if (!token) return null;
  const res = await gh(ctx, token, `/repos/${o}/${r}/contents/bridge.config.json`, 'application/vnd.github.raw');
  if (!res || res.status !== 200) return null;
  try {
    const config = JSON.parse(await res.text()) as { products?: { design?: { repo?: unknown; preview?: unknown } }[] };
    const p = (config.products ?? []).find((x) => typeof x?.design?.repo === 'string' && x.design.repo.toLowerCase() === copy);
    return typeof p?.design?.preview === 'string' && /^https:\/\//.test(p.design.preview) ? p.design.preview : null;
  } catch {
    return null;
  }
}

/** The open explorations of the watched copies whose head has no capture yet (every one with `force`), at most TODO_MAX. */
export async function shotsTodo(ctx: ShotsCtx, force = false): Promise<ShotJob[]> {
  const jobs: ShotJob[] = [];
  for (const { repo, team } of await watchedCopies(ctx.redis)) {
    if (jobs.length >= TODO_MAX) break;
    const template = await copyTemplate(ctx, team, repo);
    if (!template) continue;
    const [o, r] = repo.split('/') as [string, string];
    const token = await ctx.token(o, r);
    if (!token) continue;
    const res = await gh(ctx, token, `/repos/${o}/${r}/pulls?state=open&per_page=50`);
    if (!res || res.status !== 200) continue;
    const pulls = ((await res.json()) as { number?: unknown; head?: { sha?: unknown; ref?: unknown }; draft?: unknown }[]) ?? [];
    const kept = pulls.length ? ((await ctx.redis.pipe(pulls.map((p) => ['GET', shotKeyOf(repo, Number(p.number))]))) as (string | null)[]) : [];
    pulls.forEach((p, i) => {
      const sha = typeof p.head?.sha === 'string' ? p.head.sha : '';
      const branch = typeof p.head?.ref === 'string' ? p.head.ref : '';
      if (!Number.isSafeInteger(p.number) || !SHA.test(sha) || !branch || jobs.length >= TODO_MAX) return;
      let have: string | null = null;
      try {
        have = kept[i] ? (JSON.parse(kept[i]!).sha as string) : null;
      } catch {
        have = null;
      }
      if (force || have !== sha) jobs.push({ repo, pr: Number(p.number), sha, branch, template, hints: [] });
    });
    // The changed files of each exploration to capture: one read each, only for those.
    await Promise.all(
      jobs
        .filter((j) => j.repo === repo)
        .map(async (j) => {
          const files = await gh(ctx, token, `/repos/${o}/${r}/pulls/${j.pr}/files?per_page=100`);
          if (files?.status === 200) j.hints = fileHints(((await files.json()) as { filename?: string }[]).map((x) => x.filename ?? '').filter(Boolean));
        }),
    );
  }
  return jobs;
}

/** Keeps one capture the workflow sent: a watched copy, a webp of a sane size. */
export async function putShot(ctx: ShotsCtx, body: Record<string, unknown>): Promise<Response> {
  const repo = typeof body.repo === 'string' ? body.repo.toLowerCase() : '';
  const pr = Number(body.pr);
  const sha = typeof body.sha === 'string' ? body.sha : '';
  const image = typeof body.image === 'string' ? body.image : '';
  const url = typeof body.url === 'string' && /^https:\/\//.test(body.url) ? body.url.slice(0, 500) : null;
  if (!REPO.test(repo) || !Number.isSafeInteger(pr) || pr < 1 || !SHA.test(sha)) return json(400, { error: 'bad_request', message: 'Say which exploration: repo, pr and sha.' });
  if (!image || image.length > MAX_IMAGE_CHARS || !/^[A-Za-z0-9+/]+={0,2}$/.test(image) || !Buffer.from(image.slice(0, 32), 'base64').subarray(8, 12).equals(Buffer.from('WEBP'))) {
    return json(400, { error: 'bad_image', message: 'Send a webp image, base64, under 300 KB.' });
  }
  const meta = await ctx.redis.cmd('GET', repoMetaKey(repo));
  let kind: string | null = null;
  try {
    kind = typeof meta === 'string' ? JSON.parse(meta).kind : null;
  } catch {
    kind = null;
  }
  if (kind !== 'copy') return json(403, { error: 'not-allowed', message: 'Bridge does not watch this repository.' });
  await ctx.redis.cmd('SET', shotKeyOf(repo, pr), JSON.stringify({ sha, capturedAt: new Date(ctx.now()).toISOString(), ...(url ? { url } : {}), image }), 'EX', KEEP_S);
  return json(200, { ok: true });
}

// --- Studio's reads ----------------------------------------------------------------------------------------------------

/** When one capture was taken and of which commit, or null (none yet). */
export async function shotMeta(redis: Redis, repo: string, pr: number): Promise<{ sha: string; capturedAt: string } | null> {
  const raw = await redis.cmd('GET', shotKeyOf(repo, pr));
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : null;
    return v?.sha && v?.capturedAt ? { sha: v.sha, capturedAt: v.capturedAt } : null;
  } catch {
    return null;
  }
}

/** The image of one capture, for a reader the caller already checked, or 404. Never kept by a shared cache. */
export async function shotImage(redis: Redis, repo: string, pr: number): Promise<Response> {
  const raw = await redis.cmd('GET', shotKeyOf(repo, pr));
  let v: { image?: string } | null = null;
  try {
    v = typeof raw === 'string' ? JSON.parse(raw) : null;
  } catch {
    v = null;
  }
  if (!v?.image) throw new HttpError(404, 'not_found', 'No screenshot yet.');
  return new Response(Buffer.from(v.image, 'base64'), { status: 200, headers: { ...SECURITY_HEADERS, 'Content-Type': 'image/webp', 'Cache-Control': 'private, max-age=300' } });
}
