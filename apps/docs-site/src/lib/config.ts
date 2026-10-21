// Which repository this Bridge workspace documents and reviews, and how it works with it (owners, rights, changes
// mode, products). bridge.config.json is parsed once, by the repo model (lib/model.ts), and turned into these settings
// by @bridge-ds/core siteRepoFromConfig: the same function Studio runs in the browser on any team's config.
import type { SiteRepo } from '@bridge-ds/core';
import { jsonForScript } from './html';
import { repoModel } from './model';

export type { SiteRepo };

export const siteRepo = (): SiteRepo => repoModel.site;

/** JSON for client scripts (embedded once per page by the layout). */
export const siteRepoJson = () => jsonForScript(siteRepo());
