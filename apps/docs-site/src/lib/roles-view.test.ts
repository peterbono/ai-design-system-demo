import { describe, expect, it } from 'vitest';
import { loadConfig } from '@bridge-ds/core';
import { choiceOf, groupsOf, roleRows, rolesProposal, rolesSummary, withRoles } from './roles-view';

const owners = { design: ['dana'], tech: ['theo'] };

const CONFIG = `{
  "version": 1,
  "repo": { "owner": "acme", "name": "ds", "defaultBranch": "main" },
  "governance": {
    "protectedBranches": ["main"],
    "owners": { "design": ["dana"], "tech": ["theo"] }
  },
  "previews": {
    "packages": ["@acme/tokens"]
  }
}
`;

describe('roleRows and rolesSummary', () => {
  it('without rights: owners approve, anyone with write access ships', () => {
    const rows = roleRows(owners, null);
    expect(rows.map((r) => [r.label, r.who, r.logins])).toEqual([
      ['Approve design', 'Design owners', ['dana']],
      ['Approve tech', 'Tech owners', ['theo']],
      ['Merge', 'Anyone with write access', []],
    ]);
    // No segment says "anyone with write access": the form selects nothing for an unset ship right.
    expect(rows[2]!.choice).toBe(null);
    expect(rolesSummary(owners, null)).toBe('Design owners approve design, tech owners approve tech, anyone with write access merges.');
  });

  it('with rights: the groups and their logins', () => {
    const rights = { approveDesign: ['design'] as const, approveTech: ['tech'] as const, ship: ['design', 'tech'] as const };
    const r = { approveDesign: [...rights.approveDesign], approveTech: [...rights.approveTech], ship: [...rights.ship] };
    expect(roleRows(owners, r)[2]).toMatchObject({ who: 'Design and tech owners', logins: ['dana', 'theo'], choice: 'both' });
    expect(rolesSummary(owners, r)).toBe('Design owners approve design, tech owners approve tech, design and tech owners merge.');
  });

  it('choices map to groups and back', () => {
    expect(groupsOf('both')).toEqual(['design', 'tech']);
    expect(choiceOf(['tech', 'design'])).toBe('both');
    expect(choiceOf(['design'])).toBe('design');
  });
});

describe('withRoles', () => {
  const rights = { approveDesign: ['design' as const], approveTech: ['tech' as const], ship: ['tech' as const] };

  it('adds rights on one line after owners and leaves everything else as it was', () => {
    const next = withRoles(CONFIG, { rights, visualMode: 'auto' });
    expect(next).toBe(CONFIG.replace('"tech": ["theo"] }\n', '"tech": ["theo"] },\n    "rights": { "approveDesign": ["design"], "approveTech": ["tech"], "ship": ["tech"] }\n'));
    expect(loadConfig(JSON.parse(next)).governance.rights).toEqual(rights);
  });

  it('writes visualImpact only when the mode changes, and nothing when nothing changes', () => {
    const once = withRoles(CONFIG, { rights, visualMode: 'on-demand' });
    expect(once).toContain('"visualImpact": { "mode": "on-demand" }');
    expect(loadConfig(JSON.parse(once)).visualImpact).toEqual({ mode: 'on-demand' });
    expect(withRoles(once, { rights, visualMode: 'on-demand' })).toBe(once);
    const back = withRoles(once, { rights, visualMode: 'auto' });
    expect(back).toContain('"visualImpact": { "mode": "auto" }');
  });

  it('proposal says what changes in plain words', () => {
    const p = rolesProposal(roleRows(owners, rights), 'on-demand', { date: new Date('2026-10-18T00:00:00Z'), prefix: 'bridge/', tierLabel: 'Tier 3' });
    expect(p.branch).toBe('bridge/roles-20261018');
    expect(p.body).toContain('- Merge: Tech owners.');
    expect(p.body).toContain('- Visual before and after: On demand.');
    expect(p.body).not.toMatch(/—/);
  });
});
