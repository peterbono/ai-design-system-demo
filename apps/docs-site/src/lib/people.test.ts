import { describe, expect, it } from 'vitest';
import { authorLine, isBotLogin, isClaudeLogin, loginKey, loginsToFetch, markLogins, NAME_TTL_MS, nameBudget, personName, readNameCache } from './people';

const NOW = Date.parse('2026-10-19T12:00:00Z');

describe('personName', () => {
  it('uses the profile name when known, else the login without the @', () => {
    const cache = { peterbono: { name: 'Florian Gouloubi', at: NOW } };
    expect(personName('@PeterBono', cache)).toBe('Florian Gouloubi');
    expect(personName('@analima', cache)).toBe('analima');
    expect(personName('analima', { analima: { name: null, at: NOW } })).toBe('analima');
    expect(personName('  ', cache)).toBe('Someone');
  });

  it('names bots without the [bot] suffix and Claude as Claude', () => {
    expect(personName('github-actions[bot]')).toBe('github-actions');
    expect(personName('claude[bot]')).toBe('Claude AI');
    expect(personName('bridge-agent')).toBe('Claude AI');
    expect(personName('bridge-agent[bot]')).toBe('Claude AI');
    expect(isClaudeLogin('bridge-agent')).toBe(true);
    expect(isBotLogin('renovate[bot]')).toBe(true);
    expect(isClaudeLogin('@Claude')).toBe(true);
    expect(isClaudeLogin('claudette')).toBe(false);
    expect(loginKey(' @PeterBono ')).toBe('peterbono');
  });
});

describe('readNameCache', () => {
  it('keeps fresh entries and drops stale or malformed ones', () => {
    const raw = JSON.stringify({
      a: { name: 'Ana', at: NOW - 1000 },
      b: { name: 'Old', at: NOW - NAME_TTL_MS - 1 },
      c: { name: 3, at: NOW },
      d: { name: null, at: NOW },
      e: null,
    });
    expect(readNameCache(raw, NOW)).toEqual({ a: { name: 'Ana', at: NOW - 1000 }, d: { name: null, at: NOW } });
    expect(readNameCache('not json', NOW)).toEqual({});
    expect(readNameCache('[1]', NOW)).toEqual({});
    expect(readNameCache(null, NOW)).toEqual({});
  });
});

describe('loginsToFetch', () => {
  it('skips cached, bots, Claude and duplicates, within the budget', () => {
    const cache = { known: { name: 'Known', at: NOW } };
    expect(loginsToFetch(['@Ana', 'ana', 'known', 'renovate[bot]', 'claude', 'kenji', 'maya'], cache, 2)).toEqual(['ana', 'kenji']);
    expect(nameBudget(false)).toBeLessThan(nameBudget(true));
  });
});

describe('markLogins', () => {
  it('marks @logins in text only, not teams, emails or attributes', () => {
    expect(markLogins('<p title="@ana">Waiting for @Ana or @kenji-sato to approve.</p>')).toBe(
      '<p title="@ana">Waiting for <span data-person="ana">@Ana</span> or <span data-person="kenji-sato">@kenji-sato</span> to approve.</p>',
    );
    expect(markLogins('Ask @acme/design or mail a@b.co.')).toBe('Ask @acme/design or mail a@b.co.');
    expect(markLogins('(@renovate[bot])')).toBe('(<span data-person="renovate[bot]">@renovate[bot]</span>)');
  });
});

describe('authorLine', () => {
  it('credits Claude when an agent made the work', () => {
    const cache = { peterbono: { name: 'Florian Gouloubi', at: NOW } };
    expect(authorLine('peterbono', false, cache)).toBe('Florian Gouloubi');
    expect(authorLine('peterbono', true, cache)).toBe('Claude AI, with Florian Gouloubi');
    expect(authorLine('claude[bot]', true)).toBe('Claude AI');
    expect(authorLine('bridge-agent', false)).toBe('Claude AI');
  });
});
