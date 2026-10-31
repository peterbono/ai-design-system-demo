// Preview shots: the real thumbnail of an exploration's preview, captured by .github/workflows/preview-shots.yml
// (scripts/preview-shots.mjs) into the orphan branch bridge-shots of the team's design system repository. Studio reads
// one file, index.json, from raw.githubusercontent.com (no GitHub API quota) and shows the capture on the exploration
// page, the Studio home cards and the Changes rows; without one, the plate (lib/branch-thumb.ts). Pure: no fetch
// (scripts/preview-shots.ts reads the index). Unit tested in preview-shots.test.ts.
import { ago } from './home-model';
import type { ThumbSpec } from './branch-thumb';

export const SHOTS_BRANCH = 'bridge-shots';

/** One capture as index.json lists it, under "owner/repo#pr" (lower case). */
export interface ShotEntry {
  sha: string;
  capturedAt: string;
  /** Path in the branch: "<owner>/<repo>/<pr>.webp". */
  image: string;
  url?: string;
  route?: string;
  /** The label of the change marker the capture shows (data-bridge-change), when it found one. */
  screen?: string;
}

export interface ShotsIndex {
  shots: Record<string, ShotEntry>;
}

/** A capture Studio can show: the image URL, when it was taken, and the commit it shows. */
export interface PreviewShot {
  src: string;
  capturedAt: string;
  sha: string;
  screen: string | null;
}

const SEG = /^[a-z0-9][a-z0-9._-]*$/;
const IMAGE = /^([a-z0-9][a-z0-9._-]*)\/([a-z0-9][a-z0-9._-]*)\/(\d+)\.(webp|png)$/;

/** The raw URL of a file of the shots branch of the design system repository. */
export function shotsFileUrl(owner: string, repo: string, path: string): string {
  return `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${SHOTS_BRANCH}/${path}`;
}

export const shotsIndexUrl = (owner: string, repo: string) => shotsFileUrl(owner, repo, 'index.json');

/** "peterbono/bridge-product-admin#2": the key of a capture, lower case. */
export const shotKey = (repo: string, pr: number) => `${repo.toLowerCase()}#${pr}`;

/**
 * index.json as read, kept only where it is well formed: an entry needs a sha, a date and an image path of the shape
 * the workflow writes (owner/repo/pr.webp, matching its key), so a hand edit can never point Studio elsewhere.
 */
export function parseShotsIndex(raw: unknown): ShotsIndex | null {
  if (!raw || typeof raw !== 'object') return null;
  const shots = (raw as { shots?: unknown }).shots;
  if (!shots || typeof shots !== 'object') return null;
  const out: Record<string, ShotEntry> = {};
  for (const [key, v] of Object.entries(shots as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue;
    const e = v as Record<string, unknown>;
    const m = typeof e.image === 'string' ? IMAGE.exec(e.image) : null;
    const k = /^([^/#]+)\/([^/#]+)#(\d+)$/.exec(key);
    if (!m || !k || !SEG.test(k[1]!) || !SEG.test(k[2]!)) continue;
    if (m[1] !== k[1] || m[2] !== k[2] || m[3] !== k[3]) continue;
    if (typeof e.sha !== 'string' || !/^[0-9a-f]{7,40}$/i.test(e.sha)) continue;
    if (typeof e.capturedAt !== 'string' || !Number.isFinite(Date.parse(e.capturedAt))) continue;
    out[key] = {
      sha: e.sha,
      capturedAt: e.capturedAt,
      image: e.image as string,
      ...(typeof e.url === 'string' ? { url: e.url } : {}),
      ...(typeof e.route === 'string' ? { route: e.route } : {}),
      ...(typeof e.screen === 'string' && e.screen.trim() ? { screen: e.screen.trim().slice(0, 80) } : {}),
    };
  }
  return { shots: out };
}

/**
 * The capture of pull request `pr` of `repo` ("owner/name", this repository or a product's), stored in the shots
 * branch of `ds` (the design system repository), or null. The image URL carries the commit, so a new capture is never
 * hidden behind a cached older one.
 */
export function shotFor(index: ShotsIndex | null | undefined, ds: { owner: string; repo: string }, repo: string, pr: number): PreviewShot | null {
  const e = index?.shots[shotKey(repo, pr)];
  if (!e) return null;
  return { src: `${shotsFileUrl(ds.owner, ds.repo, e.image)}?v=${e.sha.slice(0, 7)}`, capturedAt: e.capturedAt, sha: e.sha, screen: e.screen ?? null };
}

/** "Captured 2 h ago": under a capture, where it fits. */
export const capturedLine = (capturedAt: string, now: number): string => `Captured ${ago(capturedAt, now)}`;

/** The screen thumbnail of a capture, keeping what the plate would name (shown again if the image does not load). */
export function shotThumb(shot: PreviewShot, plate?: { product?: string | null; screen?: string | null; seed?: string | null }): ThumbSpec {
  return { kind: 'screen', src: shot.src, capturedAt: shot.capturedAt, product: plate?.product ?? null, screen: plate?.screen ?? shot.screen, seed: plate?.seed ?? null };
}
