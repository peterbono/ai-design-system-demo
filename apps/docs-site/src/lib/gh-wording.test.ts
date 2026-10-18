import { describe, expect, it } from 'vitest';
import { ghAction, ghButton, ghVerb, rateLimitedLine } from './gh-wording';

describe('gh-wording', () => {
  it('says Sign in when the site has a GitHub App', () => {
    expect(ghVerb(true)).toBe('Sign in');
    expect(ghVerb(true, true)).toBe('Sign in again');
    expect(ghAction('send', true)).toBe('Sign in to send');
    expect(ghAction('propose', true, true)).toBe('Sign in again to propose');
    expect(ghButton(true)).toBe('Sign in with GitHub');
  });

  it('keeps Connect GitHub for the token paste', () => {
    expect(ghVerb(false)).toBe('Connect GitHub');
    expect(ghVerb(false, true)).toBe('Reconnect GitHub');
    expect(ghAction('send', false)).toBe('Connect GitHub to send');
    expect(ghAction('propose', false, true)).toBe('Reconnect GitHub to propose');
    expect(ghButton(false)).toBe('Connect GitHub');
  });

  it('words the rate limit for each way in', () => {
    expect(rateLimitedLine(true)).toBe('GitHub limits anonymous reads to 60 an hour and this browser has used them. Sign in, or try again later.');
    expect(rateLimitedLine(false)).toMatch(/Connect GitHub, or try again later\.$/);
  });
});
