// A token push from Figma with values only ships by itself (core branchVerdict autoShip): the Branches row, the home
// and "Needs you" say "On its way to the library", never "Tests running" or "Ready to merge".
import { describe, expect, it } from 'vitest';
import { ON_ITS_WAY, rowWho } from './pr-status';

describe('rowWho, a token push from Figma that ships by itself', () => {
  it('reads On its way to the library while it runs and once ready, and waits on nobody', () => {
    for (const kind of ['ci-running', 'ready', 'needs-design', 'needs-tech'] as const) {
      const who = rowWho(kind, { author: 'dana', autoShip: true });
      expect(who).toEqual(ON_ITS_WAY);
      expect(who?.short).toBe('On its way to the library');
      expect(who?.yourTurn).toBe(false);
    }
  });

  it('merged and closed keep their own words', () => {
    expect(rowWho('merged', { author: 'dana', autoShip: true })).not.toEqual(ON_ITS_WAY);
  });
});
