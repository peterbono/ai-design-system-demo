// What a Figma file remembers for Bridge (shared plugin data, namespace dsbridge), read and written in one place.
//
// - The design system the file is connected to, and the commit it was last pulled from: one per file, every designer
//   in the file shares them (the variables are the file's).
// - The open change ("branch") the last push went to: one per Figma user. Designer B never adds to designer A's branch
//   because they opened the same file.
//
// Pure: the main thread passes figma.root's shared plugin data as a store, tests pass a Map.

import { DEFAULT_SETTINGS, LEGACY_DEFAULT_REPO, type RepoSettings, type SyncState, syncResetOnSettings } from '../shared/messages';

export interface SharedStore {
  get(key: string): string;
  set(key: string, value: string): void;
  keys(): string[];
}

/** Sync fields kept per Figma user: the open change a push adds to. */
const PER_USER = ['lastPrBranch', 'lastPrUrl'] as const;
type PerUser = (typeof PER_USER)[number];

/** Key of a per-user field: "lastPrBranch:<Figma user id>". */
export const userKey = (field: PerUser, userId: string) => `${field}:${userId}`;

/**
 * The file's settings. No repository stored: a file older versions pulled from the repository they defaulted to keeps
 * pointing there (it holds a pull); any other file is not connected yet.
 */
export function sharedSettings(store: SharedStore): RepoSettings {
  const legacy = store.get('baseSha') || store.get('lastPullAt') ? LEGACY_DEFAULT_REPO : '';
  return {
    repo: store.get('repo') || legacy || DEFAULT_SETTINGS.repo,
    branch: store.get('branch') || DEFAULT_SETTINGS.branch,
    tokensPath: store.get('tokensPath') || DEFAULT_SETTINGS.tokensPath,
    ...(store.get('specSource') === 'measured' || store.get('specSource') === 'measured-only' ? { specSource: store.get('specSource') as 'measured' | 'measured-only' } : {}),
    ...(store.get('dsName') ? { name: store.get('dsName') } : {}),
  };
}

/** The file's sync state, with this user's open change. Without a known user, no open change: never someone else's. */
export function sharedSync(store: SharedStore, userId: string | undefined): SyncState {
  return {
    baseSha: store.get('baseSha') || undefined,
    lastPullAt: store.get('lastPullAt') || undefined,
    ...(store.get('lastCompare') ? { lastCompare: store.get('lastCompare') } : {}),
    ...(store.get('claudeAsked') ? { claudeAsked: store.get('claudeAsked') } : {}),
    ...(store.get('claudeConnector') ? { claudeConnector: store.get('claudeConnector') } : {}),
    lastPrBranch: userId ? store.get(userKey('lastPrBranch', userId)) || undefined : undefined,
    lastPrUrl: userId ? store.get(userKey('lastPrUrl', userId)) || undefined : undefined,
  };
}

/** Stores the sync fields given (undefined: unchanged). Per-user fields go under this user's key, none without one. */
export function writeSync(store: SharedStore, sync: SyncState, userId: string | undefined): void {
  if (sync.baseSha !== undefined) store.set('baseSha', sync.baseSha);
  if (sync.lastPullAt !== undefined) store.set('lastPullAt', sync.lastPullAt);
  if (sync.lastCompare !== undefined) store.set('lastCompare', sync.lastCompare);
  if (sync.claudeAsked !== undefined) store.set('claudeAsked', sync.claudeAsked);
  if (sync.claudeConnector !== undefined) store.set('claudeConnector', sync.claudeConnector);
  if (!userId) return;
  for (const field of PER_USER) if (sync[field] !== undefined) store.set(userKey(field, userId), sync[field]!);
}

/**
 * Saves new settings and clears what no longer holds (syncResetOnSettings). A per-user field is cleared for every
 * user of the file: another repository or branch makes everyone's open change stale. Also clears the file-wide key
 * older versions shared between users.
 */
export function saveSettings(store: SharedStore, settings: RepoSettings): RepoSettings {
  const before = sharedSettings(store);
  store.set('repo', settings.repo.trim());
  store.set('branch', settings.branch.trim());
  store.set('tokensPath', settings.tokensPath.trim().replace(/^\/+|\/+$/g, ''));
  // Static is the default: nothing stored until a developer turns Measured on.
  const measured = settings.specSource === 'measured' || settings.specSource === 'measured-only' ? settings.specSource : '';
  if (measured || store.get('specSource')) store.set('specSource', measured);
  // The name belongs to the repository: another repository forgets it until its own config is read.
  const name = (settings.name ?? (settings.repo.trim() === before.repo ? before.name : undefined) ?? '').trim();
  if (name || store.get('dsName')) store.set('dsName', name);
  const reset = syncResetOnSettings(before, sharedSettings(store));
  for (const [field, value] of Object.entries(reset)) {
    if ((PER_USER as readonly string[]).includes(field)) {
      for (const key of store.keys()) if (key === field || key.startsWith(`${field}:`)) store.set(key, value);
    } else store.set(field, value);
  }
  return sharedSettings(store);
}
