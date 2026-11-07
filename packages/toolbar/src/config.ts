// Where a product's toolbar gets its facts when it is mounted with only the design system repository and its product
// key: the design system's bridge.config.json, read once per session through Bridge's read proxy (GitHub directly when
// Bridge refuses; public repositories, no account). Pure part (buildFromConfig) is tested; loadBuild adds the read and
// the session cache.
import { DEFAULT_PROXY, githubReads, type Reads } from './reads';
import { isPreviewUrl, type BridgeBuild } from './session';

interface ConfigLike {
  repo?: { owner?: string; name?: string; defaultBranch?: string };
  tokens?: { root?: string };
  previews?: { apps?: Record<string, string | undefined>; production?: Record<string, string | undefined> };
  products?: { key?: string; repo?: string; preview?: string; production?: string; design?: { repo?: string; preview?: string } }[];
}

/** Values the product sets itself win over the config: the Studio, production and preview URLs. */
export interface BuildOverrides {
  studio?: string | null;
  production?: string | null;
  preview?: string | null;
  deployEnv?: string | null;
  /**
   * The repository this deploy was built from ("owner/name", such as VERCEL_GIT_REPO_OWNER/VERCEL_GIT_REPO_SLUG): when
   * it is the design team's copy of the product (products[].design.repo), the toolbar reads the copy's explorations
   * and its preview pattern. Any other value is ignored.
   */
  repo?: string | null;
  /** Bridge's origin for reads (default production Bridge), null to read GitHub directly. */
  proxy?: string | null;
  /**
   * The page's own address (loadBuild passes location.href): a deploy whose host matches the design copy's preview
   * template is the copy's, even when neither the host nor the link said which repository it was built from
   * (Cloudflare Pages sets no repository variable). Without it, a change number read the developers' or the design
   * system's change of the same number.
   */
  href?: string | null;
}

const REPO = /^[\w.-]+\/[\w.-]+$/;

/**
 * The toolbar's facts for one product of a design system config: its repository (its own, else the design system's),
 * production Studio, its production URL and preview template. Null when the product is not in the config.
 */
export function buildFromConfig(raw: unknown, ds: string, product: string, overrides: BuildOverrides = {}): BridgeBuild | null {
  if (!raw || typeof raw !== 'object' || !REPO.test(ds)) return null;
  const config = raw as ConfigLike;
  const entry = (config.products ?? []).find((p) => p?.key === product);
  if (!entry) return null;
  const own = entry.repo && REPO.test(entry.repo) ? entry.repo : null;
  // A deploy of the design team's copy: the copy's explorations and previews.
  const designRepo = own && entry.design?.repo && REPO.test(entry.design.repo) ? entry.design.repo : null;
  const named = overrides.repo?.trim().toLowerCase() === designRepo?.toLowerCase();
  const onCopyPreview = !overrides.repo && isPreviewUrl(overrides.href, entry.design?.preview ?? null);
  const copy = designRepo && (named || onCopyPreview) ? designRepo : null;
  const [owner, repo] = (copy ?? own ?? ds).split('/') as [string, string];
  const pick = (v: string | null | undefined, fallback: string | null | undefined) => (v !== undefined ? v : (fallback ?? null));
  return {
    owner,
    repo,
    studio: pick(overrides.studio, config.previews?.production?.docs),
    production: pick(overrides.production, entry.production ?? config.previews?.production?.[product]),
    preview: pick(overrides.preview, copy ? entry.design?.preview : (entry.preview ?? config.previews?.apps?.[product])),
    deployEnv: overrides.deployEnv ?? null,
    ...(overrides.proxy !== undefined ? { proxy: overrides.proxy } : {}),
    defaultBranch: config.repo?.defaultBranch ?? 'main',
    tokensRoot: config.tokens?.root ?? 'packages/tokens/src',
    product,
    ds,
  };
}

const cacheKey = (ds: string) => `bridge-toolbar:config:v1:${ds}`;

/** Reads the design system's bridge.config.json (its default branch), kept for the session. */
export async function loadBuild(ds: string, product: string, overrides: BuildOverrides = {}, gh?: Reads): Promise<BridgeBuild> {
  let config: unknown = null;
  try {
    const cached = window.sessionStorage.getItem(cacheKey(ds));
    if (cached) config = JSON.parse(cached);
  } catch {
    // Storage blocked or a broken entry: read it again.
  }
  if (!config) {
    if (!REPO.test(ds)) throw new Error(`"${ds}" is not a GitHub repository (owner/name).`);
    const [owner, name] = ds.split('/') as [string, string];
    const reads = gh ?? githubReads({ team: ds, proxy: overrides.proxy === undefined ? DEFAULT_PROXY : overrides.proxy });
    const text = await reads.file(owner, name, null, 'bridge.config.json').catch((e: Error) => {
      throw new Error(`Could not read bridge.config.json from ${ds} (${e.message})`);
    });
    config = JSON.parse(text);
    try {
      window.sessionStorage.setItem(cacheKey(ds), JSON.stringify(config));
    } catch {
      // Storage blocked: the next page reads it again.
    }
  }
  const href = overrides.href !== undefined ? overrides.href : typeof window === 'undefined' ? null : window.location.href;
  const build = buildFromConfig(config, ds, product, { ...overrides, href });
  if (!build) throw new Error(`No product "${product}" in ${ds}'s bridge.config.json.`);
  return build;
}
