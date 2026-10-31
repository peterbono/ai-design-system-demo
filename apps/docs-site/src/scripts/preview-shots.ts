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
  return shotFor(index, ds, own ? own.repo : `${ds.owner}/${ds.repo}`, x.number);
}
