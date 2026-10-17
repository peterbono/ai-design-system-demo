// Typed message protocol between the UI iframe (network + logic) and the main thread (figma.*).
// The main thread never talks to the network; the UI never touches figma.variables.

import { TIER_NAMES, type Tier, defineConfig } from '@bridge-ds/core';
import type { ScannedComponent } from '../sync/components';
// The repo's own bridge.config.json prefills the settings; every file can point elsewhere in Settings.
import rootConfig from '../../../../bridge.config.json';

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
  /** File a single-mode token (primitive, base, component) lives in, relative to the tokens path. */
  file?: string | undefined;
  /** Unit of a dimension token (px, rem). */
  unit?: string | undefined;
  /** "array" when a fontFamily value is a list joined with ", " in Figma. */
  shape?: string | undefined;
  /** Set when the token was removed on main: kept in Figma, never deleted silently. */
  orphan?: boolean | undefined;
  /** Modes in which the token does not exist in Git (single-collection layout only). */
  absentModes?: string[] | undefined;
  /** Modes whose alias a pull could not set (target missing): the value there is not a Figma edit. */
  unlinkedModes?: string[] | undefined;
}

export const PLUGIN_DATA_KEYS = ['id', 'dtcgType', 'file', 'unit', 'shape', 'orphan', 'absentModes', 'unlinkedModes'] as const;

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
  | { kind: 'alias-token'; path: string; tokenId?: string | undefined; tier?: Tier | undefined };

export interface PlannedVariable {
  tokenId: string;
  path: string;
  /** Figma variable name ("color/action/primary/bg"). */
  name: string;
  tier: Tier;
  resolvedType: FigmaResolvedType;
  description: string;
  scopes: string[];
  /** Mode key of the token's tier ("light", "bridge", "compact"...) or "value" for single-mode tiers. */
  values: Record<string, PlannedValue>;
  /** Existing variables for this token (several in the split "<Collection>/<Mode>" layout). */
  existingVariableIds: string[];
  pluginData: VariablePluginData;
}

/** One Figma collection per tier, with the tier's mode keys in order. */
export interface PlannedCollection {
  tier: Tier;
  name: string;
  /** ["value"] for single-mode tiers, ["bridge", "ocean"] for Brand, ["light", "dark"] for Semantic... */
  modes: string[];
}

export interface PullPlan {
  collections: PlannedCollection[];
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

/** Local components with their current signature and stored baseline. */
export interface ScannedComponentsPayload {
  components: ScannedComponent[];
  /** Often undefined in published plugins: requests then name the node without a link. */
  fileKey: string | undefined;
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
  'scan-components': { request: Record<string, never>; response: ScannedComponentsPayload };
  /** Store signatures (JSON) as baselines on component nodes. */
  'save-signatures': { request: { items: { nodeId: string; signature: string }[] }; response: { saved: number } };
  /** Re-read one component and store it as the baseline (after its request is sent). */
  rebaseline: { request: { nodeId: string }; response: { saved: boolean } };
  /** PNG 2x as base64: the selected variant of `nodeId`, the component itself, or the selection without `nodeId`. */
  'export-image': { request: { nodeId?: string | undefined }; response: { base64: string; name: string } | null };
  selection: { request: Record<string, never>; response: { nodeId: string; name: string } | null };
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

const defaults = defineConfig(rootConfig as Parameters<typeof defineConfig>[0]);
const defaultRepo = defaults.repo ?? { owner: '', name: '', defaultBranch: 'main' };
/**
 * Prefilled settings, from bridge.config.json at the root of this repo. At scan time the plugin also
 * reads bridge.config.json from the configured repository, which decides the token paths there.
 */
export const DEFAULT_SETTINGS: RepoSettings = {
  repo: defaultRepo.owner ? `${defaultRepo.owner}/${defaultRepo.name}` : '',
  branch: defaultRepo.defaultBranch,
  tokensPath: defaults.tokens.root,
};

/** Figma collection of each tier. */
/** Figma collection of each tier (same names as the tiers in @bridge-ds/core). */
export const COLLECTIONS: Record<Tier, string> = TIER_NAMES;
export const COLLECTION_PRIMITIVES = COLLECTIONS.primitive;
export const COLLECTION_SEMANTIC = COLLECTIONS.semantic;
/** Mode name of single-mode collections (Primitives, Base, Component). */
export const PRIMITIVE_MODE_NAME = 'Value';

export { modeDisplayName } from '@bridge-ds/core';
import { modeDisplayName } from '@bridge-ds/core';
/** Free-plan fallback: one collection per mode, "Semantic/Light", "Brand/Ocean"... */
export const splitCollectionName = (collection: string, mode: string) => `${collection}/${modeDisplayName(mode)}`;

export function isRequest(msg: unknown): msg is RequestEnvelope {
  return !!msg && typeof msg === 'object' && (msg as { kind?: unknown }).kind === 'request';
}

export function isResponse(msg: unknown): msg is ResponseEnvelope {
  return !!msg && typeof msg === 'object' && (msg as { kind?: unknown }).kind === 'response';
}
