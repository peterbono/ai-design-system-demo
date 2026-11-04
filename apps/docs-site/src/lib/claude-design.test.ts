// Settings > Your AI tools: the quiet Claude Design line, for admins only.
import { describe, expect, it } from 'vitest';
import { CLAUDE_DESIGN_WORDS, claudeDesignLine, claudeDesignRequest, parseServedLibrary } from './claude-design';

const served = { name: 'Bridge Library', version: '1.8.4' };
const team = { url: 'https://claude.ai/artifact/YZ1z4WxSWErcMHVDcbFmkW', version: '1.8.3' };

describe('claudeDesignLine', () => {
  it('is for admins only', () => {
    expect(claudeDesignLine({ admin: false, served, team })).toBeNull();
    expect(claudeDesignLine({ admin: true, served, team })).not.toBeNull();
  });

  it('stays hidden when the site serves no Library', () => {
    expect(claudeDesignLine({ admin: true, served: null, team })).toBeNull();
    expect(parseServedLibrary({ version: 'nope' })).toBeNull();
    expect(parseServedLibrary(null)).toBeNull();
    expect(parseServedLibrary({ name: 'Bridge Library', version: '1.8.4', files: [] })).toEqual(served);
  });

  it('says an update is ready, and the request names the same artifact and asks for the changed files only', () => {
    const line = claudeDesignLine({ admin: true, served, team })!;
    expect(line.text).toBe('Claude Design: Bridge Library 1.8.4 · Update available');
    expect(line.status).toBe('update');
    expect(line.request).toContain('bridge_get_claude_design_system');
    expect(line.request).toContain(team.url);
    expect(line.request).toMatch(/only the files that changed/);
    expect(line.request).toMatch(/re-run the install at 1\.8\.4 in the canvases/);
  });

  it('offers to add it when the team never did, and says nothing to do when it is current', () => {
    const fresh = claudeDesignLine({ admin: true, served, team: null })!;
    expect(fresh.text).toBe('Claude Design: Bridge Library 1.8.4 · Not added yet');
    expect(fresh.request).toBe(claudeDesignRequest(served, null));
    expect(fresh.request).toMatch(/create the Design System artifact/);
    const current = claudeDesignLine({ admin: true, served, team: { ...team, version: '1.8.4' } })!;
    expect(current.text).toBe('Claude Design: Bridge Library 1.8.4 · Up to date');
    expect(current.request).toBeNull();
  });

  it('writes no em dash', () => {
    for (const s of [claudeDesignRequest(served, null), claudeDesignRequest(served, team), ...Object.values(CLAUDE_DESIGN_WORDS.status), CLAUDE_DESIGN_WORDS.copy, CLAUDE_DESIGN_WORDS.copied]) expect(s).not.toMatch(/—/);
  });
});
