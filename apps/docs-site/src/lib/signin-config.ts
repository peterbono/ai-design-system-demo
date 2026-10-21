// Build-time settings of Sign in with GitHub (docs/SIGN-IN.md): the GitHub App client ID from the host's env vars,
// the production and preview addresses and the changes mode from bridge.config.json. Two apps: "Bridge"
// (GITHUB_APP_SUGGEST_CLIENT_ID, read only, the default) and "Bridge Direct" (GITHUB_APP_CLIENT_ID, used when
// "changes" is "direct"). Client IDs are public: they are written into the pages. Null when neither is set: the
// Studio then offers the token paste only, exactly as before.
import { signInConfigFrom, type SignInConfig } from './github-signin';
import { exists, readJson } from './repo';

interface RawSignIn {
  previews?: { apps?: { docs?: string }; production?: { docs?: string } };
  changes?: string;
}

let cache: SignInConfig | null | undefined;

export function signInConfig(): SignInConfig | null {
  if (cache !== undefined) return cache;
  const raw = exists('bridge.config.json') ? readJson<RawSignIn>('bridge.config.json') : {};
  cache = signInConfigFrom(
    { GITHUB_APP_CLIENT_ID: process.env.GITHUB_APP_CLIENT_ID, GITHUB_APP_SUGGEST_CLIENT_ID: process.env.GITHUB_APP_SUGGEST_CLIENT_ID },
    raw.previews,
    raw.changes,
  );
  return cache;
}

/** The config as an attribute value for client scripts ("null" when off). */
export const signInConfigJson = () => JSON.stringify(signInConfig());
