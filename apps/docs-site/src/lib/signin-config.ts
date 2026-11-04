// Build-time settings of Sign in with GitHub (docs/SIGN-IN.md): Bridge Direct's client ID from the host's env vars
// (GITHUB_APP_CLIENT_ID, public: it is written into the pages) and the production and preview addresses from
// bridge.config.json (read through the repo model, lib/model.ts). One GitHub App signs everyone in, on every page.
// Null when the client ID is not set: the Studio then offers the token paste only, exactly as before.
import { appSlugFrom, signInConfigFrom, type SignInConfig, type SignInEnv } from './github-signin';
import { repoModel } from './model';

const signInEnv = (): SignInEnv => ({
  GITHUB_APP_CLIENT_ID: process.env.GITHUB_APP_CLIENT_ID,
  GITHUB_APP_DIRECT_SLUG: process.env.GITHUB_APP_DIRECT_SLUG,
});

/** The slug install links use, written on <html data-gh-slug> by the layout for the browser (lib/access-view.ts). */
export const appSlugAtBuild = (): string => appSlugFrom(signInEnv());

let cache: SignInConfig | null | undefined;

export function signInConfig(): SignInConfig | null {
  if (cache === undefined) cache = signInConfigFrom(signInEnv(), repoModel.config.previews);
  return cache;
}

/** The config as an attribute value for client scripts ("null" when off). */
export const signInConfigJson = () => JSON.stringify(signInConfig());
