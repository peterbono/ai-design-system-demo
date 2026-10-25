import { describe, expect, it } from 'vitest';
import { canKeepExploration, keepExplorationLine, READER_SUGGESTS, routeFor, sendModeFor } from './write-route';

describe('which way a write goes', () => {
  it('a reader in direct mode suggests, or gets nothing when the action has no suggestion', () => {
    expect(routeFor({ write: false }, 'direct')).toBe('suggest');
    expect(routeFor({ write: false }, 'direct', false)).toBe('none');
    expect(sendModeFor({ write: false }, 'direct')).toBe('suggest');
  });
  it('a writer keeps the team mode; suggest mode stays suggest', () => {
    expect(routeFor({ write: true }, 'direct')).toBe('direct');
    expect(routeFor({ write: true }, 'suggest')).toBe('suggest');
    expect(routeFor({ write: true }, 'suggest', false)).toBe('none');
    expect(sendModeFor({ write: true }, 'direct')).toBe('direct');
  });
  it('unknown access and email members keep the team mode', () => {
    expect(routeFor(null, 'direct')).toBe('direct');
    expect(routeFor({ write: true, contributor: true }, 'direct')).toBe('direct');
  });
});

describe('who keeps an exploration', () => {
  it('the person who started it or a reviewer, with write access', () => {
    expect(canKeepExploration({ viewer: 'Ana', author: 'ana', reviewer: false, write: true })).toBe(true);
    expect(canKeepExploration({ viewer: 'ben', author: 'ana', reviewer: true, write: true })).toBe(true);
    expect(canKeepExploration({ viewer: 'ben', author: 'ana', reviewer: false, write: true })).toBe(false);
    expect(canKeepExploration({ viewer: 'ana', author: 'ana', reviewer: false, write: false })).toBe(false);
    expect(canKeepExploration({ viewer: null, author: 'ana', reviewer: true, write: true })).toBe(false);
  });
  it('says who can, in designer words', () => {
    expect(keepExplorationLine('ana')).toBe('Only @ana, who started it, or a reviewer can send it for review or close it.');
    for (const t of [keepExplorationLine('ana'), READER_SUGGESTS]) expect(t).not.toMatch(/\b(PR|pull request|branch|merge|repo)\b|—/i);
  });
});
