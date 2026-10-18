import { describe, expect, it } from 'vitest';
import { fitScale, isStageToken, previewSamples } from './preview-fit';

describe('fitScale', () => {
  it('shrinks large content to fit the box', () => {
    expect(fitScale({ width: 400, height: 100 }, { width: 200, height: 100 })).toBe(0.5);
    expect(fitScale({ width: 100, height: 300 }, { width: 200, height: 150 })).toBe(0.5);
  });

  it('grows small content up to the cap', () => {
    expect(fitScale({ width: 50, height: 20 }, { width: 200, height: 100 })).toBe(1.25);
    expect(fitScale({ width: 50, height: 20 }, { width: 200, height: 100 }, { max: 1 })).toBe(1);
    expect(fitScale({ width: 180, height: 50 }, { width: 200, height: 100 })).toBe(1.111);
  });

  it('keeps padding inside the box', () => {
    expect(fitScale({ width: 180, height: 80 }, { width: 200, height: 100 }, { pad: 10, max: 1 })).toBe(1);
    expect(fitScale({ width: 360, height: 80 }, { width: 200, height: 100 }, { pad: 10 })).toBe(0.5);
  });

  it('returns 1 before layout', () => {
    expect(fitScale({ width: 0, height: 0 }, { width: 200, height: 100 })).toBe(1);
    expect(fitScale({ width: 10, height: 10 }, { width: 0, height: 100 })).toBe(1);
  });
});

describe('isStageToken', () => {
  it('takes page backgrounds and surfaces only', () => {
    expect(isStageToken('color.bg.subtle')).toBe(true);
    expect(isStageToken('color.surface.raised')).toBe(true);
    expect(isStageToken('color.background.default')).toBe(true);
    expect(isStageToken('color.action.primary.bg')).toBe(false);
    expect(isStageToken('color.feedback.danger.bg')).toBe(false);
    expect(isStageToken('color.text.default')).toBe(false);
  });
});

describe('previewSamples', () => {
  const available = ['Button', 'Card', 'Input', 'Badge', 'Table', 'Tabs'];

  it('keeps the components that use the token and have a sample', () => {
    expect(previewSamples(['Button', 'Dialog', 'Badge'], available)).toEqual({ names: ['Button', 'Badge'], usesToken: true });
  });

  it('caps the count', () => {
    expect(previewSamples(available, available, { max: 3 }).names).toEqual(['Button', 'Card', 'Input']);
  });

  it('falls back when no component using the token has a sample', () => {
    expect(previewSamples(['Dialog'], available, { fallback: ['Card', 'Table', 'Missing'] })).toEqual({ names: ['Card', 'Table'], usesToken: false });
    expect(previewSamples([], available)).toEqual({ names: [], usesToken: false });
  });
});
