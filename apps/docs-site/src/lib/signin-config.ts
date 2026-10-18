// Build-time settings of Sign in with GitHub (docs/SIGN-IN.md): the GitHub App client ID from the host's env vars,
// the production and preview addresses from bridge.config.json. Null when GITHUB_APP_CLIENT_ID is not set:
// the Studio then offers the token paste only, exactly as before.
import { signInConfigFrom, type SignInConfig } from './github-signin';
import { exists, readJson } from './repo';

interface RawPreviews {
  previews?: { apps?: { docs?: string }; production?: { docs?: string } };
}

let cache: SignInConfig | null | undefined;

export function signInConfig(): SignInConfig | null {
  if (cache !== undefined) return cache;
  const previews = exists('bridge.config.json') ? readJson<RawPreviews>('bridge.config.json').previews : undefined;
  cache = signInConfigFrom({ GITHUB_APP_CLIENT_ID: process.env.GITHUB_APP_CLIENT_ID }, previews);
  return cache;
}

/** The config as an attribute value for client scripts ("null" when off). */
export const signInConfigJson = () => JSON.stringify(signInConfig());
