import { describe, expect, it } from 'vitest';
import { teamNameProblem, teamNameProposal, withTeamName } from './team-name';

const FILE = '{\n  "$schema": "./schema.json",\n  "version": 1,\n  "repo": "acme/ds",\n  "tokens": { "root": "tokens" }\n}\n';

describe('the team name in bridge.config.json', () => {
  it('adds `name` right after `version`, the rest byte for byte', () => {
    const next = withTeamName(FILE, '  Acme   Design ');
    expect(JSON.parse(next).name).toBe('Acme Design');
    expect(next.indexOf('"name"')).toBeGreaterThan(next.indexOf('"version"'));
    expect(next.indexOf('"name"')).toBeLessThan(next.indexOf('"repo"'));
    expect(next).toContain('"tokens": { "root": "tokens" }');
  });

  it('changes only the value of a name already there, and nothing when it is the same', () => {
    const named = withTeamName(FILE, 'Acme');
    expect(withTeamName(named, 'Acme')).toBe(named);
    expect(JSON.parse(withTeamName(named, 'Acme Design')).name).toBe('Acme Design');
  });

  it('says what is wrong with a name, in one sentence', () => {
    expect(teamNameProblem(' ')).toBe('Type a name for your team.');
    expect(teamNameProblem('x'.repeat(61))).toBe('Keep it to 60 characters.');
    expect(teamNameProblem('Acme')).toBeNull();
    expect(() => withTeamName(FILE, '')).toThrow('Type a name for your team.');
  });

  it('proposes it as a config pull request', () => {
    const p = teamNameProposal('Acme Design', { date: new Date('2026-10-22T00:00:00Z'), prefix: 'bridge/', tierLabel: 'Tier 3 (guardrail file)' });
    expect(p.branch).toBe('bridge/team-name-acme-design-20261022');
    expect(p.title).toBe('chore(config): name the team "Acme Design"');
    expect(p.body).toContain('Sets `name` to "Acme Design" in `bridge.config.json`.');
    expect(p.body).toContain('**Risk:** Tier 3 (guardrail file).');
  });
});
