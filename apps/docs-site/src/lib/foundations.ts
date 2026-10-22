// Build-time data of the Library foundation pages: thin wrappers over the pure lib/library/foundations.ts with the
// build-time repo model (lib/model.ts).
import * as lib from './library/foundations';
import type { FoundationRow } from './library/foundations';
import { repoModel } from './model';
import type { Tier } from './tokens';

export type { FoundationRow } from './library/foundations';

export const foundationRow = (path: string): FoundationRow => lib.foundationRow(repoModel, path);

/** Rows of every non-primitive token in a group ("color.bg"), in file order. Semantic and brand tiers by default. */
export const groupRows = (group: string, tiers?: readonly Tier[]): FoundationRow[] => lib.groupRows(repoModel, group, tiers);

/** Rows of every primitive under a prefix ("space", "font.size"), in file order. */
export const primitiveRows = (prefix: string): FoundationRow[] => lib.primitiveRows(repoModel, prefix);
