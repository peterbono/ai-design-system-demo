import { describe, expect, it } from 'vitest';
import { figmaCell, loadFigmaCoverage } from './figma-coverage';

describe('figma coverage', () => {
  it('names each state in a word, with the reason for the ones not in Figma', () => {
    expect(figmaCell({ name: 'Button', status: 'generated' })).toEqual({ label: 'Yes' });
    expect(figmaCell({ name: 'Select', status: 'unsupported', reason: 'opens a popup' })).toEqual({ label: 'Not yet', title: 'Not supported yet: opens a popup' });
    expect(figmaCell({ name: 'Stack', status: 'layout', reason: 'layout only, use auto layout' })!.label).toBe('Auto layout');
    expect(figmaCell(undefined)).toBeUndefined();
  });

  it('reads the committed coverage: every component folder is listed', () => {
    const cov = loadFigmaCoverage();
    expect(cov.get('Button')?.status).toBe('generated');
    expect(cov.get('Stack')?.status).toBe('layout');
    expect([...cov.values()].some((c) => c.status === 'unsupported' && !!c.reason)).toBe(true);
  });
});
