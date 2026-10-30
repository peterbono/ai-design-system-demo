// Where a product's toolbar gets its facts when it is mounted with only the design system repository and its product
// key: the design system's bridge.config.json, read once per session from GitHub (public repositories, no account).
// Pure part (buildFromConfig) is tested; loadBuild adds the read and the session cache.
import type { BridgeBuild } from './session';

interface ConfigLike {
  repo?: { owner?: string; name?: string; defaultBranch?: string };
  tokens?: { root?: string };
  previews?: { apps?: Record<string, string | undefined>; production?: Record<string, string | undefined> };
  products?: { key?: string; repo?: string; preview?: string; production?: string }[];
}

/** Values the product sets itself win over the config: the Studio, production and preview URLs. */
export interface BuildOverrides {
  studio?: string | null;
  production?: string | null;
  preview?: string | null;
  deployEnv?: string | null;
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
  const [owner, repo] = (own ?? ds).split('/') as [string, string];
  const pick = (v: string | null | undefined, fallback: string | null | undefined) => (v !== undefined ? v : (fallback ?? null));
  return {
    owner,
    repo,
    studio: pick(overrides.studio, config.previews?.production?.docs),
    production: pick(overrides.production, entry.production ?? config.previews?.production?.[product]),
    preview: pick(overrides.preview, entry.preview ?? config.previews?.apps?.[product]),
    deployEnv: overrides.deployEnv ?? null,
    defaultBranch: config.repo?.defaultBranch ?? 'main',
    tokensRoot: config.tokens?.root ?? 'packages/tokens/src',
    product,
    ds,
  };
}

const cacheKey = (ds: string) => `bridge-toolbar:config:v1:${ds}`;

/** Reads the design system's bridge.config.json (its default branch), kept for the session. */
export async function loadBuild(ds: string, product: string, overrides: BuildOverrides = {}): Promise<BridgeBuild> {
  let config: unknown = null;
  try {
    const cached = window.sessionStorage.getItem(cacheKey(ds));
    if (cached) config = JSON.parse(cached);
  } catch {
    // Storage blocked or a broken entry: read it again.
  }
  if (!config) {
    if (!REPO.test(ds)) throw new Error(`"${ds}" is not a GitHub repository (owner/name).`);
    const r = await fetch(`https://raw.githubusercontent.com/${ds}/HEAD/bridge.config.json`);
    if (!r.ok) throw new Error(`Could not read bridge.config.json from ${ds} (GitHub answered ${r.status}).`);
    config = await r.json();
    try {
      window.sessionStorage.setItem(cacheKey(ds), JSON.stringify(config));
    } catch {
      // Storage blocked: the next page reads it again.
    }
  }
  const build = buildFromConfig(config, ds, product, overrides);
  if (!build) throw new Error(`No product "${product}" in ${ds}'s bridge.config.json.`);
  return build;
}
