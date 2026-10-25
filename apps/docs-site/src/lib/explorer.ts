// Token explorer data of this build, embedded in the page as JSON: thin wrappers over the pure
// lib/library/explorer.ts with the build-time repo model (lib/model.ts).
import * as lib from './library/explorer';
import type { ExplorerToken } from './library/explorer';
import { repoModel } from './model';

export type { ExplorerContrast, ExplorerLink, ExplorerMode, ExplorerToken } from './library/explorer';
export { previewKind } from './library/explorer';

/** Token files of this build, keyed by path relative to tokens.root, as the explorer and @bridge-ds/core buildTokenSet read them. */
export const tokenFiles = (): Record<string, string> => lib.tokenFiles(repoModel);

export const explorerTokens = (): ExplorerToken[] => lib.explorerTokens(repoModel);
