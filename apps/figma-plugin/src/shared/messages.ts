// Typed message protocol between the UI iframe (network + logic) and the main thread (figma.*).
// The main thread never talks to the network; the UI never touches figma.variables.

export type FigmaResolvedType = 'COLOR' | 'FLOAT' | 'STRING' | 'BOOLEAN';

export type FigmaValue =
  | { kind: 'color'; r: number; g: number; b: number; a: number }
  | { kind: 'float'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'boolean'; value: boolean }
  /** Alias to another variable. `name` is filled for targets outside the local collections. */
  | { kind: 'alias'; id: string; name?: string | undefined };

/** Plugin data DS Bridge stores on each variable it manages (string values in Figma). */
export interface VariablePluginData {
  /** Stable token id, same as `$extensions["com.dsbridge.id"]` or "path:<path at first sync>". */
  id?: string | undefined;
  /** DTCG `$type` (Figma only knows COLOR/FLOAT/STRING/BOOLEAN). */
  dtcgType?: string | undefined;
  /** Primitive file the token lives in, relative to the tokens path. */
  file?: string | undefined;
  /** Unit of a dimension token (px, rem). */
  unit?: string | undefined;
  /** "array" when a fontFamily value is a list joined with ", " in Figma. */
  shape?: string | undefined;
  /** Set when the token was removed on main: kept in Figma, never deleted silently. */
  orphan?: boolean | undefined;
  /** Theme modes in which the token does not exist in Git (single-collection layout only). */
  absentModes?: string[] | undefined;
}

export const PLUGIN_DATA_KEYS = ['id', 'dtcgType', 'file', 'unit', 'shape', 'orphan', 'absentModes'] as const;

export interface SnapshotVariable {
  id: string;
  name: string;
  collectionId: string;
  resolvedType: FigmaResolvedType;
  description: string;
  scopes: string[];
  valuesByMode: Record<string, FigmaValue>;
  pluginData: VariablePluginData;
}

export interface SnapshotCollection {
  id: string;
  name: string;
  modes: { modeId: string; name: string }[];
  defaultModeId: string;
  remote: boolean;
}

export interface FigmaSnapshot {
  fileName: string;
  collections: SnapshotCollection[];
  variables: SnapshotVariable[];
}

/** A value the main thread should write. Aliases point at another token by path. */
export type PlannedValue =
  | Exclude<FigmaValue, { kind: 'alias' }>
  /** Alias to the variable of another token, found by token id first, then by path. */
  | { kind: 'alias-token'; path: string; tokenId?: string | undefined };

export interface PlannedVariable {
  tokenId: string;
  path: string;
  /** Figma variable name ("color/action/primary/bg"). */
  name: string;
  tier: 'primitive' | 'semantic';
  resolvedType: FigmaResolvedType;
  description: string;
  scopes: string[];
  /** Theme mode key ("light", "dark") or "value" for primitives. */
  values: Record<string, PlannedValue>;
  /** Existing variables for this token (several in the split "Semantic/<Mode>" layout). */
  existingVariableIds: string[];
  pluginData: VariablePluginData;
}

export interface PullPlan {
  /** Theme mode keys in order, for example ["light", "dark"]. */
  modes: string[];
  variables: PlannedVariable[];
  orphans: { variableId: string; name: string }[];
  /** Commit the plan was built from; stored as the new base after a successful apply. */
  headSha: string;
}

export interface ApplyReport {
  created: number;
  updated: number;
  orphaned: number;
  layout: 'single-collection' | 'split-collections';
  errors: string[];
}

export interface RepoSettings {
  repo: string;
  branch: string;
  tokensPath: string;
}

export interface SyncState {
  /** main commit the Figma file was last pulled from: the "base" of the three-way diff. */
  baseSha?: string | undefined;
  lastPullAt?: string | undefined;
  lastPrBranch?: string | undefined;
  lastPrUrl?: string | undefined;
}

export interface InitPayload {
  settings: RepoSettings;
  sync: SyncState;
  hasToken: boolean;
  /** Sent to the UI so it can call GitHub. The UI keeps it in memory and never renders it. */
  token: string | undefined;
  fileName: string;
}

export interface VariableTag {
  variableId: string;
  pluginData: VariablePluginData;
}

/** Request name -> payload sent by the UI and payload returned by the main thread. */
export interface RequestMap {
  init: { request: Record<string, never>; response: InitPayload };
  'save-settings': { request: { settings: RepoSettings }; response: RepoSettings };
  'save-token': { request: { token: string }; response: { saved: true } };
  'clear-token': { request: Record<string, never>; response: { cleared: true } };
  snapshot: { request: Record<string, never>; response: FigmaSnapshot };
  'apply-pull': { request: { plan: PullPlan }; response: ApplyReport };
  'save-sync': { request: { sync: SyncState }; response: SyncState };
  'tag-variables': { request: { tags: VariableTag[] }; response: { tagged: number } };
  'open-url': { request: { url: string }; response: { opened: true } };
  notify: { request: { message: string; error?: boolean }; response: { shown: true } };
  resize: { request: { width: number; height: number }; response: { resized: true } };
}

export type RequestType = keyof RequestMap;

export interface RequestEnvelope<K extends RequestType = RequestType> {
  kind: 'request';
  reqId: number;
  type: K;
  payload: RequestMap[K]['request'];
}

export type ResponseEnvelope =
  | { kind: 'response'; reqId: number; ok: true; payload: unknown }
  | { kind: 'response'; reqId: number; ok: false; error: string };

/** Unsolicited progress update from the main thread during long operations. */
export interface ProgressEnvelope {
  kind: 'progress';
  message: string;
}

export function isProgress(msg: unknown): msg is ProgressEnvelope {
  return !!msg && typeof msg === 'object' && (msg as { kind?: unknown }).kind === 'progress';
}

export const DEFAULT_SETTINGS: RepoSettings = {
  repo: 'peterbono/ai-design-system-demo',
  branch: 'main',
  tokensPath: 'packages/tokens/src',
};

export const COLLECTION_PRIMITIVES = 'Primitives';
export const COLLECTION_SEMANTIC = 'Semantic';
export const PRIMITIVE_MODE_NAME = 'Value';

export const modeDisplayName = (mode: string) => mode.charAt(0).toUpperCase() + mode.slice(1);
export const splitCollectionName = (mode: string) => `${COLLECTION_SEMANTIC}/${modeDisplayName(mode)}`;

export function isRequest(msg: unknown): msg is RequestEnvelope {
  return !!msg && typeof msg === 'object' && (msg as { kind?: unknown }).kind === 'request';
}

export function isResponse(msg: unknown): msg is ResponseEnvelope {
  return !!msg && typeof msg === 'object' && (msg as { kind?: unknown }).kind === 'response';
}
