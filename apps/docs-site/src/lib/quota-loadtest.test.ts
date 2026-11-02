// A quick smoke run of the GitHub quota load test (docs/QUOTA-LOADTEST.md, the full run is
// `npm run loadtest:github -w @bridge-ds/docs-site`): a few simulated minutes through the real read path, the fake
// GitHub counting calls. Holds the properties the report relies on.
import { describe, expect, it } from 'vitest';
import { runScenario, scenarios } from '../../test/quota/sim';

const MIN = 60 * 1000;

describe('quota load test (smoke)', () => {
  it('a lead reloading the same pages costs GitHub only the first misses, then free 304s and hits', async () => {
    const a = scenarios({ duration: 12 * MIN }).find((s) => s.name === 'A')!;
    const r = await runScenario({ ...a, updates: 0 });
    expect(r.pageLoads).toBe(6);
    expect(r.counted).toBeGreaterThan(0);
    // Past the 30 s fresh window, unchanged answers are revalidated with their ETag: GitHub answers 304, uncounted.
    expect(r.free).toBeGreaterThan(0);
    expect(r.busyAnswers).toBe(0);
    expect(r.capHits).toBe(0);
    // Every page load after the first of its kind is answered from the cache or by a free 304.
    expect(r.hitRatio).toBeGreaterThan(0.3);
  });

  it('a burst of people on Home shares one set of GitHub calls instead of one per person', async () => {
    const d = scenarios().find((s) => s.name === 'D')!;
    const ten = await runScenario({ ...d, people: d.people.slice(0, 10) });
    expect(ten.busyAnswers).toBe(0);
    // Ten people on the same reads cost far less than ten times one person's reads.
    expect(ten.counted).toBeLessThan(ten.reads / 3);
  });
});
