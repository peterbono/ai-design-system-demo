// What Studio says Claude does must be true on the site (decision D4): Claude never builds a change on its own, a
// developer builds it with Claude. A designer never waits "for Claude", nor gets terminal steps for "my Claude".
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SITE = fileURLToPath(new URL('../..', import.meta.url));
const CODE = /\.(ts|tsx|astro)$/;
const TEST = /\.test\.tsx?$/;
const BROKEN = [/waiting for (your )?claude/i, /\bClaude builds it\b/, /Let Claude build/, /Your Claude plan/, /Draft with my Claude/, /Ask your Claude/];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : CODE.test(n) && !TEST.test(n) ? [p] : [];
  });
}

describe('Claude promises', () => {
  it('no screen promises that Claude builds or answers on its own', () => {
    const found = files(join(SITE, 'src')).flatMap((f) =>
      readFileSync(f, 'utf8')
        .split('\n')
        .flatMap((line, i) => (BROKEN.some((re) => re.test(line)) ? [`${relative(SITE, f)}:${i + 1}: ${line.trim()}`] : [])),
    );
    expect(found).toEqual([]);
  });
});
