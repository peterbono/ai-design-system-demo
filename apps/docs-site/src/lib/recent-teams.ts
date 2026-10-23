// The team chip's "Recent teams" in this browser's localStorage (RECENT_TEAMS_KEY): read, cleaned, remembered after a
// team page read its repository, forgotten on a 404 or when someone removes it from the menu. The rules live in
// access-view.ts; this file only does the storage, every access wrapped so a blocked storage gives an empty list.
// Covered by recent-teams.test.ts with an in-memory storage.

import type { RepoAccessState } from '@bridge-ds/core';
import { teamDisplayName } from './demo';
import { forgetsTeam, noteName, parseRecentTeams, parseTeamNames, pushRecentTeam, RECENT_TEAMS_KEY, remembersTeam, removeRecentTeam, TEAM_NAMES_KEY, TEAM_ROLES_KEY } from './access-view';

export type RecentStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** This browser's localStorage, or null when the browser blocks it. */
export function browserStore(): RecentStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function write(store: RecentStore | null, list: readonly string[]) {
  if (!store) return;
  try {
    if (list.length) store.setItem(RECENT_TEAMS_KEY, JSON.stringify(list));
    else store.removeItem(RECENT_TEAMS_KEY);
  } catch {
    /* storage blocked or full: the menu shows what it has */
  }
}

/** The recent teams, cleaned: placeholders and invalid names are dropped from the storage too. */
export function loadRecentTeams(store: RecentStore | null = browserStore()): string[] {
  if (!store) return [];
  let raw: string | null = null;
  try {
    raw = store.getItem(RECENT_TEAMS_KEY);
  } catch {
    return [];
  }
  const list = parseRecentTeams(raw);
  if (raw !== null && raw !== JSON.stringify(list)) write(store, list);
  return list;
}

/** Removes `team` from the recent teams and returns the new list. */
export function forgetRecentTeam(team: string, store: RecentStore | null = browserStore()): string[] {
  const list = removeRecentTeam(loadRecentTeams(store), team);
  write(store, list);
  return list;
}

/**
 * What a team page does once its access is known: a repository it read is remembered first, one GitHub answered 404
 * for is forgotten, anything else (not known yet, App not set up) leaves the list alone. Returns the new list.
 */
export function noteTeamAccess(team: string, state: RepoAccessState | null | undefined, store: RecentStore | null = browserStore()): string[] {
  const list = loadRecentTeams(store);
  if (remembersTeam(state)) {
    const next = pushRecentTeam(list, team);
    write(store, next);
    return next;
  }
  if (forgetsTeam(state)) return forgetRecentTeam(team, store);
  return list;
}

function loadMap(key: string, store: RecentStore | null): Record<string, string> {
  if (!store) return {};
  try {
    return parseTeamNames(store.getItem(key));
  } catch {
    return {};
  }
}

function noteMap(key: string, team: string, value: string | null | undefined, store: RecentStore | null): Record<string, string> {
  const next = noteName(loadMap(key, store), team, value, loadRecentTeams(store));
  if (!store) return next;
  try {
    if (Object.keys(next).length) store.setItem(key, JSON.stringify(next));
    else store.removeItem(key);
  } catch {
    /* storage blocked or full: the menu falls back to what it knows */
  }
  return next;
}

/** The names the recent teams go by in this browser (TEAM_NAMES_KEY), {} when the storage is blocked. */
export const loadTeamNames = (store: RecentStore | null = browserStore()) => loadMap(TEAM_NAMES_KEY, store);

/** A team page read its settings: remember the name it goes by (none: forget it), for the recent teams only. */
export const noteTeamName = (team: string, name: string | null | undefined, store: RecentStore | null = browserStore()) => noteMap(TEAM_NAMES_KEY, team, name, store);

/** The teams the signed-in person belongs to in this browser, with their role words (TEAM_ROLES_KEY). */
export const loadTeamRoles = (store: RecentStore | null = browserStore()) => loadMap(TEAM_ROLES_KEY, store);

/** A team page knows the person's access: remember their role there (none: they do not belong to it). */
export const noteTeamRole = (team: string, role: string | null | undefined, store: RecentStore | null = browserStore()) => noteMap(TEAM_ROLES_KEY, team, role, store);

/**
 * The names of the signed-in account's teams as the server keeps them (bridge.config.json `name`, GET /api/account),
 * so a team page names its team right from the first paint, before its own settings are read: the sidebar never
 * changes names after load. Lower-case "owner/repo" to name; cleared when the server says nobody is signed in.
 */
export const ACCOUNT_TEAM_NAMES_KEY = 'bridge.accountTeamNames';

/** Keeps the account's team names (null: nobody signed in, forget them). */
export function noteAccountTeamNames(teams: readonly { repo: string; name?: string | null }[] | null, store: RecentStore | null = browserStore()): void {
  if (!store) return;
  try {
    // Only names a team set: the repository in words is what every page falls back to anyway.
    const named = (teams ?? []).filter((t) => t.name?.trim() && t.name.trim() !== teamDisplayName(t.repo));
    if (!named.length) return store.removeItem(ACCOUNT_TEAM_NAMES_KEY);
    store.setItem(ACCOUNT_TEAM_NAMES_KEY, JSON.stringify(Object.fromEntries(named.map((t) => [t.repo.toLowerCase(), t.name!.trim()]))));
  } catch {
    /* storage blocked: the page names the team once its settings are read */
  }
}

/** The name this browser already knows for `team`: the one its page last read, else the account's (server-kept). */
export function knownTeamName(team: string, store: RecentStore | null = browserStore()): string | null {
  const k = team.toLowerCase();
  return loadMap(TEAM_NAMES_KEY, store)[k] ?? loadMap(ACCOUNT_TEAM_NAMES_KEY, store)[k] ?? null;
}
