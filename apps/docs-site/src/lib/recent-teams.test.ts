// The team chip's recent teams in storage: cleaned on read, remembered only after a real read, removable.
import { describe, expect, it } from 'vitest';
import { RECENT_TEAMS_KEY } from './access-view';
import { forgetRecentTeam, loadRecentTeams, noteTeamAccess, type RecentStore } from './recent-teams';

function memory(initial?: unknown): RecentStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set(RECENT_TEAMS_KEY, JSON.stringify(initial));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const blocked: RecentStore = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('SecurityError');
  },
  removeItem: () => {
    throw new Error('SecurityError');
  },
};

const stored = (s: ReturnType<typeof memory>) => JSON.parse(s.data.get(RECENT_TEAMS_KEY) ?? 'null') as unknown;

describe('recent teams in storage', () => {
  it('cleans placeholders out of the stored list when it is read', () => {
    const s = memory(['owner/design', 'acme/ds', 'owner/repo', 'not a team']);
    expect(loadRecentTeams(s)).toEqual(['acme/ds']);
    expect(stored(s)).toEqual(['acme/ds']);
    const only = memory(['owner/design']);
    expect(loadRecentTeams(only)).toEqual([]);
    expect(only.data.has(RECENT_TEAMS_KEY)).toBe(false);
  });

  it('leaves a clean list untouched and an empty storage empty', () => {
    const s = memory(['acme/ds']);
    let writes = 0;
    const counting: RecentStore = { ...s, setItem: (k, v) => (writes++, s.setItem(k, v)) };
    expect(loadRecentTeams(counting)).toEqual(['acme/ds']);
    expect(writes).toBe(0);
    expect(loadRecentTeams(memory())).toEqual([]);
  });

  it('remembers a team after a successful read, newest first', () => {
    const s = memory(['acme/ds']);
    for (const state of ['anonymous-public', 'reader', 'writer', 'admin', 'outside-contributor'] as const) {
      const t = memory(['acme/ds']);
      expect(noteTeamAccess('globex/tokens', state, t)).toEqual(['globex/tokens', 'acme/ds']);
    }
    noteTeamAccess('globex/tokens', 'writer', s);
    expect(stored(s)).toEqual(['globex/tokens', 'acme/ds']);
  });

  it('never remembers a team that did not load, and forgets one GitHub answered 404 for', () => {
    for (const state of [null, undefined, 'not-installed'] as const) {
      const s = memory(['acme/ds']);
      expect(noteTeamAccess('typo/nothing', state, s)).toEqual(['acme/ds']);
      expect(stored(s)).toEqual(['acme/ds']);
    }
    for (const state of ['no-access', 'anonymous-unknown'] as const) {
      const s = memory(['acme/ds', 'gone/repo']);
      expect(noteTeamAccess('gone/repo', state, s)).toEqual(['acme/ds']);
      expect(stored(s)).toEqual(['acme/ds']);
    }
  });

  it('never remembers a placeholder, even when it loads', () => {
    const s = memory(['acme/ds']);
    expect(noteTeamAccess('owner/design', 'anonymous-public', s)).toEqual(['acme/ds']);
  });

  it('removes one team on request', () => {
    const s = memory(['acme/ds', 'globex/tokens']);
    expect(forgetRecentTeam('acme/ds', s)).toEqual(['globex/tokens']);
    expect(stored(s)).toEqual(['globex/tokens']);
    expect(forgetRecentTeam('globex/tokens', s)).toEqual([]);
    expect(s.data.has(RECENT_TEAMS_KEY)).toBe(false);
  });

  it('gives an empty list when storage is blocked, without throwing', () => {
    expect(loadRecentTeams(blocked)).toEqual([]);
    expect(noteTeamAccess('acme/ds', 'reader', blocked)).toEqual(['acme/ds']);
    expect(forgetRecentTeam('acme/ds', blocked)).toEqual([]);
    expect(loadRecentTeams(null)).toEqual([]);
  });
});
