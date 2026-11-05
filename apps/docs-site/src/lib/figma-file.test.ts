import { describe, expect, it } from 'vitest';
import { loadConfig } from '@bridge-ds/core';
import { FIGMA_FILE_WORDS, figmaFileLabel, figmaFileProposal, withFigmaFile } from './figma-file';

const KEY = 'AbCdEf0123456789XyZ';
const LINK = `https://www.figma.com/design/${KEY}/Acme-Library?node-id=0-1`;
const CONFIG = '{\n  "version": 1,\n  "repo": { "owner": "acme", "name": "ds" },\n  "changes": "direct"\n}\n';

describe('the team Figma file setting', () => {
  it('adds figma.file at the end and keeps every other byte; replaces it when set; no-op when the same', () => {
    const once = withFigmaFile(CONFIG, ` ${LINK} `);
    expect(once).toBe(`{\n  "version": 1,\n  "repo": { "owner": "acme", "name": "ds" },\n  "changes": "direct",\n  "figma": { "file": "${LINK}" }\n}\n`);
    expect(loadConfig(once).figma).toEqual({ file: LINK });
    const twice = withFigmaFile(once, KEY);
    expect(loadConfig(twice).figma).toEqual({ file: KEY });
    expect(withFigmaFile(twice, KEY)).toBe(twice);
    expect(() => withFigmaFile(CONFIG, 'not a link')).toThrow('Paste a link to a Figma file.');
  });

  it('names the file as its link does, never by its key', () => {
    expect(figmaFileLabel(LINK)).toBe('Acme Library');
    expect(figmaFileLabel(`https://www.figma.com/design/${KEY}/branch/BrAnCh0123456/Branch-Name`)).toBe('Branch Name');
    expect(figmaFileLabel(KEY)).toBe('Open in Figma');
  });

  it('designer words: no technical vocabulary, no em dash', () => {
    for (const w of Object.values(FIGMA_FILE_WORDS)) expect(w).not.toMatch(/—|\bJSON\b|\bkey\b|\brepo\b|repository/i);
    const p = figmaFileProposal(LINK, { date: new Date('2026-11-05T00:00:00Z'), prefix: 'bridge/', tierLabel: 'Tier 3' });
    expect(p.branch).toBe('bridge/figma-file-20261105');
    expect(p.body).toContain(`Sets \`figma.file\` to ${LINK}`);
  });
});
