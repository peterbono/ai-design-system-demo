// Runtime state of one token explorer instance, shared by its modules.
import type { ContrastPair, ContrastResult, TokenSet } from '@bridge-ds/core';
import type { Syntax } from '../../lib/explorer/format';
import type { TokenMark } from '../../lib/view-scope';
import type { Column, ColumnPlan, Filters, Modes, Selection, UsageMap, ViewState, XToken } from '../../lib/explorer/model';

export type ExplorerMode = 'read' | 'edit';

export interface ExplorerState {
  mode: ExplorerMode;
  selection: Selection;
  filters: Filters;
  view: ViewState;
  syntax: Syntax;
  showCode: boolean;
  showDescription: boolean;
  /** One flat table, full token names, no section rows (Studio). */
  flat: boolean;
  /** Collapsed section keys. */
  collapsed: Set<string>;
  /** Collapsed tree nodes in the left pane (collection tier or group key). */
  treeOpen: Set<string>;
  /** Token shown in the detail panel. */
  selected: string | null;
  /** Grid cell holding the roving tabindex: row path (or "sec:<key>") and column index. */
  active: { row: string; col: number } | null;
}

export interface ExplorerData {
  /** The token set cells show: the head, or the draft applied to it in edit mode. */
  set: TokenSet;
  head: TokenSet;
  tokens: XToken[];
  byPath: Map<string, XToken>;
  usage: UsageMap;
  pairs: ContrastPair[];
  results: ContrastResult[];
  /** Contrast before the draft (edit mode), for before -> after. */
  before: ContrastResult[];
  modes: Modes;
  /** Repository directory of the token files (bridge.config.json tokens.root), for "Defined in". */
  tokensRoot?: string;
  /** The repository (bridge.config.json repo), for the quiet "Open on GitHub" link of a token's file. */
  repo?: { owner: string; name: string; defaultBranch: string };
  /** Component name -> token paths its CSS reads (the components index), for the "Used by" rows. */
  reads?: Record<string, string[]>;
  /** Studio Tokens showing an open change (lib/view-scope): the tokens it changes, against the latest library. */
  marks?: Map<string, TokenMark>;
  /** Formats a latest library value for the "before" of a changed token. */
  formatBefore?: (type: string, value: unknown) => string;
}

export interface View {
  /** Tokens in the table, after selection and filters, in table order. */
  visible: XToken[];
  plan: ColumnPlan;
  columns: Column[];
}
