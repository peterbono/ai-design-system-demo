// `npm run loadtest:github -w @bridge-ds/docs-site`: every scenario of docs/QUOTA-LOADTEST.md over a simulated hour,
// printed as the report's table. With QUOTA_OUT=<file>, the raw results are written there as JSON too.
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { kinds, limits, table } from './report';
import { runScenario, scenarios, type Result } from './sim';

describe('GitHub quota load test', () => {
  it('measures every scenario', async () => {
    const out: Result[] = [];
    for (const s of scenarios()) {
      const started = Date.now();
      out.push(await runScenario(s));
      console.log(`${s.name} done in ${((Date.now() - started) / 1000).toFixed(1)} s`);
    }
    console.log(`\n${table(out)}\n\n${limits(out)}\n\n${kinds(out)}\n`);
    if (process.env.QUOTA_OUT) writeFileSync(process.env.QUOTA_OUT, `${JSON.stringify(out, null, 2)}\n`);
    expect(out.every((r) => r.pageLoads > 0)).toBe(true);
  });
});
