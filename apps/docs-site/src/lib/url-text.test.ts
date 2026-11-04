// A copyable address on a phone wraps at its own separators, never mid-word (components/ds/studio/TeamLink UrlText).
import { describe, expect, it } from 'vitest';
import { urlBreaks } from '../components/ds/studio/TeamLink';

describe('urlBreaks', () => {
  it('breaks after the scheme, each slash and each dot, and keeps every character', () => {
    const url = 'https://bridge.floriangouloubi.com/library/';
    expect(urlBreaks(url)).toEqual(['https://', 'bridge.', 'floriangouloubi.', 'com/', 'library/']);
    expect(urlBreaks(url).join('')).toBe(url);
  });

  it('keeps an address with nothing to break on whole', () => {
    expect(urlBreaks('localhost')).toEqual(['localhost']);
    expect(urlBreaks('https://bridge.floriangouloubi.com/mcp').at(-1)).toBe('mcp');
  });
});
