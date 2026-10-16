// Runtime state of one token explorer instance, shared by its modules.
import type { ContrastPair, ContrastResult, TokenSet } from '@bridge-ds/core';
import type { Syntax } from '../../lib/explorer/format';
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
}

export interface View {
  /** Tokens in the table, after selection and filters, in table order. */
  visible: XToken[];
  plan: ColumnPlan;
  columns: Column[];
}
