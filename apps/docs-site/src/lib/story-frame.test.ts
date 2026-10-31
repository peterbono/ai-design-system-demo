import { describe, expect, it } from 'vitest';
import { embedStoryUrl, postedStoryHeight } from './story-frame';

describe('story frame', () => {
  it('appends the embed parameter to a story URL', () => {
    expect(embedStoryUrl('https://sb.example.com/iframe.html?id=a--b&viewMode=story')).toBe('https://sb.example.com/iframe.html?id=a--b&viewMode=story&embed=bridge');
    expect(embedStoryUrl('https://sb.example.com/iframe.html')).toBe('https://sb.example.com/iframe.html?embed=bridge');
  });

  it('reads only a sane posted story height', () => {
    expect(postedStoryHeight({ type: 'bridge:story-height', height: 211.4 })).toBe(212);
    expect(postedStoryHeight({ type: 'bridge:story-height', height: 1e9 })).toBe(10000);
    expect(postedStoryHeight({ type: 'storybook-channel', height: 200 })).toBeNull();
    expect(postedStoryHeight({ type: 'bridge:story-height', height: '200' })).toBeNull();
    expect(postedStoryHeight({ type: 'bridge:story-height', height: 0 })).toBeNull();
    expect(postedStoryHeight({ type: 'bridge:story-height', height: Number.NaN })).toBeNull();
    expect(postedStoryHeight(null)).toBeNull();
    expect(postedStoryHeight('bridge:story-height')).toBeNull();
  });
});
