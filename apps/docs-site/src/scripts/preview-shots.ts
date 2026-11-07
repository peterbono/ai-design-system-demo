// Preview shots in the browser: reads index.json of the bridge-shots branch of the team's design system repository
// once per page (raw.githubusercontent.com: no GitHub API call, no quota), and answers the capture of one
// exploration. A team without the workflow, a private repository or any failure answers null: the plate stays.
// Rules and URLs: lib/preview-shots.ts.
import { parseShotsIndex, shotFor, shotsIndexUrl, type PreviewShot, type ShotsIndex } from '../lib/preview-shots';
import { readRepo } from './github-session';

let read: { key: string; at: number; index: Promise<ShotsIndex | null> } | null = null;
/** The raw file is cached 5 minutes by GitHub: a page open longer reads it again after that. */
const FRESH_MS = 5 * 60 * 1000;

export function loadShotsIndex(): Promise<ShotsIndex | null> {
  const { owner, repo } = readRepo();
  const key = `${owner}/${repo}`.toLowerCase();
  if (read && read.key === key && Date.now() - read.at < FRESH_MS) return read.index;
  const index = fetch(shotsIndexUrl(owner, repo), { credentials: 'omit', referrerPolicy: 'no-referrer' })
    .then((r) => (r.ok ? r.json() : null))
    .then(parseShotsIndex)
    .catch(() => null);
  read = { key, at: Date.now(), index };
  return index;
}

/**
 * The capture of an exploration: `product` set for one in a product's own repository (bridge.config.json
 * products[].repo), else the design system repository's pull request `number`.
 */
export async function previewShotOf(x: { number: number; product?: string | null | undefined }): Promise<PreviewShot | null> {
  const ds = readRepo();
  // The product repositories module loads only for a product's exploration (pages that never list one skip it).
  const own = x.product ? (await import('./product-repos')).productRepoByKey(x.product) : null;
  if (x.product && !own) return null;
  const index = await loadShotsIndex();
  const found = shotFor(index, ds, own ? own.repo : `${ds.owner}/${ds.repo}`, x.number);
  if (found || !own) return found;
  // A private product's capture: kept by Bridge (api/_lib/private-shots.ts), read through the team for its readers.
  return bridgeShotOf(`${ds.owner}/${ds.repo}`, own.repo, x.number);
}

const bridgeShots = new Map<string, Promise<PreviewShot | null>>();

/** A capture Bridge keeps for a private product, through the team (members, and visitors of a demo team), or null. */
export function bridgeShotOf(team: string, repo: string, pr: number): Promise<PreviewShot | null> {
  const k = `${team}|${repo}#${pr}`.toLowerCase();
  const held = bridgeShots.get(k);
  if (held) return held;
  const q = `repo=${encodeURIComponent(team)}&shot=${encodeURIComponent(repo)}&pr=${pr}`;
  const p = fetch(`/api/contribute?${q}&meta=1`, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
    .then((r) => (r.ok ? (r.json() as Promise<{ shot?: { sha?: string; capturedAt?: string } | null }>) : null))
    .then((d) => (d?.shot?.sha && d.shot.capturedAt ? { src: `/api/contribute?${q}&v=${d.shot.sha.slice(0, 7)}`, capturedAt: d.shot.capturedAt, sha: d.shot.sha, screen: null } : null))
    .catch(() => null);
  bridgeShots.set(k, p);
  return p;
}
