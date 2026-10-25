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
      ['Approve design', 'Design reviewers', ['dana']],
      ['Approve code', 'Code reviewers', ['theo']],
      ['Add to the library', 'Anyone with write access', []],
    ]);
    // No segment says "anyone with write access": the form selects nothing for an unset ship right.
    expect(rows[2]!.choice).toBe(null);
    expect(rolesSummary(owners, null)).toBe('Design reviewers approve design, code reviewers approve code, anyone with write access adds to the library.');
  });

  it('with rights: the groups and their logins', () => {
    const rights = { approveDesign: ['design'] as const, approveTech: ['tech'] as const, ship: ['design', 'tech'] as const };
    const r = { approveDesign: [...rights.approveDesign], approveTech: [...rights.approveTech], ship: [...rights.ship] };
    expect(roleRows(owners, r)[2]).toMatchObject({ who: 'Design and code reviewers', logins: ['dana', 'theo'], choice: 'both' });
    expect(rolesSummary(owners, r)).toBe('Design reviewers approve design, code reviewers approve code, design and code reviewers add to the library.');
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
    expect(p.body).toContain('- Add to the library: Code reviewers.');
    expect(p.body).toContain('- Visual before and after: On demand.');
    expect(p.body).not.toMatch(/—/);
  });
});

describe('leads publishing small changes, edited with the review rules', () => {
  const rights = { approveDesign: ['design'], approveTech: ['tech'], ship: ['tech'] } as const;
  const r = { approveDesign: [...rights.approveDesign], approveTech: [...rights.approveTech], ship: [...rights.ship] };
  it('writes false when turned off, removes the key when turned back on, and leaves the file alone when unchanged', () => {
    const off = withRoles(CONFIG, { rights: r, visualMode: 'auto', leadsPublishTier1: false });
    expect(loadConfig(JSON.parse(off)).governance.leadsPublishTier1).toBe(false);
    const on = withRoles(off, { rights: r, visualMode: 'auto', leadsPublishTier1: true });
    expect(JSON.parse(on).governance.leadsPublishTier1).toBeUndefined();
    expect(loadConfig(JSON.parse(on)).governance.leadsPublishTier1).toBeUndefined();
    const same = withRoles(CONFIG, { rights: r, visualMode: 'auto' });
    expect(withRoles(same, { rights: r, visualMode: 'auto', leadsPublishTier1: true })).toBe(same);
    expect(withRoles(off, { rights: r, visualMode: 'auto' })).toBe(off);
  });
  it('says the setting in the proposal', () => {
    const p = rolesProposal(roleRows(owners, r), 'auto', { date: new Date('2026-10-25'), tierLabel: 'Tier 3', leadsPublishTier1: false });
    expect(p.body).toMatch(/Leads can publish small changes without review: off/);
    expect(rolesProposal(roleRows(owners, r), 'auto', { date: new Date('2026-10-25'), tierLabel: 'Tier 3' }).body).not.toMatch(/Leads can publish/);
  });
});
