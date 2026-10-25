// Build-time settings of Sign in with GitHub (docs/SIGN-IN.md): the GitHub App client ID from the host's env vars,
// the production and preview addresses and the changes mode from bridge.config.json (read through the repo model,
// lib/model.ts). Two apps: "Bridge" (GITHUB_APP_SUGGEST_CLIENT_ID, read only, the default) and "Bridge Direct"
// (GITHUB_APP_CLIENT_ID, used when "changes" is "direct"). Client IDs are public: they are written into the pages.
// Null when neither is set: the Studio then offers the token paste only, exactly as before.
// Team pages (`hosted`) always sign in with Bridge and carry Bridge Direct for the one-time OK of a direct-mode team.
import { signInConfigFrom, type SignInConfig } from './github-signin';
import { repoModel } from './model';

const cache = new Map<boolean, SignInConfig | null>();

export function signInConfig(hosted = false): SignInConfig | null {
  const kept = cache.get(hosted);
  if (kept !== undefined) return kept;
  const { config } = repoModel;
  const cfg = signInConfigFrom(
    {
      GITHUB_APP_CLIENT_ID: process.env.GITHUB_APP_CLIENT_ID,
      GITHUB_APP_SUGGEST_CLIENT_ID: process.env.GITHUB_APP_SUGGEST_CLIENT_ID,
      GITHUB_APP_DIRECT_SLUG: process.env.GITHUB_APP_DIRECT_SLUG,
    },
    config.previews,
    config.changes,
    { hosted },
  );
  cache.set(hosted, cfg);
  return cfg;
}

/** The config as an attribute value for client scripts ("null" when off). */
export const signInConfigJson = (hosted = false) => JSON.stringify(signInConfig(hosted));
