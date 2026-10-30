// An exploration's guard check ("Exploration not merged as is") fails by design while it is one: every check summary
// of Studio, the MCP server and the CLI leaves it out then, and keeps it for any other pull request.
import { describe, expect, it } from 'vitest';
import {
  EXPLORATION_CHECK,
  explorationStateLabel,
  GitHubClient,
  isExplorationCheck,
  isGuardedExploration,
  summarizeCi,
} from '../src';

const guard = { name: EXPLORATION_CHECK, status: 'completed', conclusion: 'failure' };
const tests = { name: 'Unit and a11y tests', status: 'completed', conclusion: 'success' };
const NOTE = '<!-- bridge-exploration {"name":"Pill buttons","purpose":"","slug":"pill-buttons"} -->';

describe('isGuardedExploration', () => {
  it('holds while the exploration label is on, archived ones included', () => {
    expect(isGuardedExploration({ state: 'open', draft: true, labels: [{ name: 'exploration' }] })).toBe(true);
    expect(isGuardedExploration({ state: 'open', draft: true, labels: ['exploration', 'archived'] })).toBe(true);
  });

  it('holds for a running exploration whose label is missing (explore/* draft)', () => {
    expect(isGuardedExploration({ state: 'open', draft: true, labels: [], head: { ref: 'explore/pill-buttons' } })).toBe(true);
    expect(isGuardedExploration({ state: 'open', draft: true, labels: [], headRef: 'feat/x', body: NOTE })).toBe(true);
  });

  it('does not hold for other pull requests', () => {
    expect(isGuardedExploration({ state: 'open', draft: false, labels: [{ name: 'tier: 2' }], head: { ref: 'feat/x' } })).toBe(false);
    expect(isGuardedExploration({ state: 'open', draft: true, labels: ['ready-for-devs'], headRef: 'explore/pill-buttons' })).toBe(false);
    expect(isGuardedExploration({ state: 'closed', labels: ['exploration'] })).toBe(false);
  });

  it('names the check', () => {
    expect(isExplorationCheck('Exploration not merged as is')).toBe(true);
    expect(isExplorationCheck('Guardrails')).toBe(false);
  });
});

describe('summarizeCi on an exploration', () => {
  it('leaves the guard check out: the exploration passes when the rest passes', () => {
    const ci = summarizeCi([guard, guard, tests], [], { exploration: true });
    expect(ci.state).toBe('pass');
    expect(ci.failed).toEqual([]);
    expect(ci.total).toBe(1);
  });

  it('leaves a guard commit status out too', () => {
    expect(summarizeCi([tests], [{ context: EXPLORATION_CHECK, state: 'failure' }], { exploration: true }).state).toBe('pass');
  });

  it('still reports a real failure on an exploration', () => {
    const ci = summarizeCi([guard, { ...tests, conclusion: 'failure' }], [], { exploration: true });
    expect(ci.state).toBe('fail');
    expect(ci.failed.map((f) => f.name)).toEqual(['Unit and a11y tests']);
  });

  it('keeps counting the guard on a pull request that is no exploration', () => {
    const ci = summarizeCi([guard, tests]);
    expect(ci.state).toBe('fail');
    expect(ci.failed.map((f) => f.name)).toEqual([EXPLORATION_CHECK]);
    expect(summarizeCi([guard, tests], [], { exploration: false }).state).toBe('fail');
  });

  it('reads none when the guard was the only check', () => {
    expect(summarizeCi([guard], [], { exploration: true }).state).toBe('none');
  });
});

describe('GitHubClient getChecks on an exploration', () => {
  const client = () => {
    const fetchImpl = async (url: string) => {
      const body = /check-runs/.test(url) ? { check_runs: [{ id: 1, ...guard }, { id: 2, ...tests }] } : { statuses: [] };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    return new GitHubClient('o/r', 't', fetchImpl as never, { attempts: 1, baseDelayMs: 0, sleep: async () => {} }, { etags: false });
  };

  it('folds the head without the guard for an exploration, with it otherwise', async () => {
    expect((await client().getChecks('abc', { exploration: true })).state).toBe('success');
    expect((await client().getChecks('abc')).state).toBe('failure');
  });
});

describe('explorationStateLabel: the one status tag of an exploration', () => {
  it('says what its page says while it runs', () => {
    expect(explorationStateLabel({ status: 'active', files: ['.bridge/explorations/pill-buttons.md'] })).toBe('Not started');
    expect(explorationStateLabel({ status: 'active', files: [] })).toBe('Not started');
    expect(explorationStateLabel({ status: 'active', files: ['.bridge/explorations/x.md', 'apps/admin/src/App.tsx'] })).toBe('Exploring');
  });

  it('waits for the files rather than guessing, and reads a failed read as exploring', () => {
    expect(explorationStateLabel({ status: 'active' })).toBeNull();
    expect(explorationStateLabel({ status: 'active', files: null })).toBe('Exploring');
  });

  it('reads archived, and where it stands after done exploring', () => {
    expect(explorationStateLabel({ status: 'active', archived: true })).toBe('Archived');
    expect(explorationStateLabel({ status: 'ready' })).toBe('Waiting for code');
    expect(explorationStateLabel({ status: 'building' })).toBe('Being built');
    expect(explorationStateLabel({ status: 'shipped', archived: true })).toBe('Shipped');
  });
});
