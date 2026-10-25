import { describe, expect, it } from 'vitest';
import { parseContrastChecks } from '@bridge-ds/core';
import { teamBrandInput, teamDraftScope } from './team-new-brand';
import { draftKey, DRAFT_KEY } from './new-brand';

const model = (over: Partial<{ configText: string | null; files: Record<string, string> }> = {}) => ({
  configText: 'configText' in over ? over.configText! : '{"tokens":{"root":"tokens"}}',
  tokens: { root: 'tokens', files: over.files ?? { 'brands/acme.tokens.json': '{}' }, rows: {} as never, usage: null },
  contrast: { path: undefined, specs: [{ fg: 'color.text.default', bg: 'color.bg.default', usage: 'text' as const, min: 4.5 }], pairs: [] },
});

describe('teamBrandInput', () => {
  it('passes the token files and the config as read', () => {
    const r = teamBrandInput(model());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.files).toEqual({ 'brands/acme.tokens.json': '{}' });
    expect(r.configText).toContain('tokens');
  });

  it('writes the contrast specs back as a pairs file the flow parses', () => {
    const r = teamBrandInput(model());
    if (!r.ok) throw new Error('expected ok');
    const pairs = parseContrastChecks(r.contrastText);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ foreground: 'color.text.default', background: 'color.bg.default', min: 4.5 });
  });

  it('says why a brand cannot start: no config, then no token files', () => {
    expect(teamBrandInput(model({ configText: null }))).toEqual({ ok: false, reason: 'no-config' });
    expect(teamBrandInput(model({ files: {} }))).toEqual({ ok: false, reason: 'no-tokens' });
  });
});

describe('draft scope', () => {
  it('keeps one draft per team, and the plain key on the self-hosted Studio', () => {
    expect(draftKey()).toBe(DRAFT_KEY);
    expect(draftKey(teamDraftScope({ owner: 'Acme', repo: 'DS' }))).toBe(`${DRAFT_KEY}:acme/ds`);
  });
});
