// api/_lib/fix-engine.gen.js is @bridge-ds/core bundled for the server (scripts/build-fix-engine.mjs): the Claude fix
// runs on Bridge's server use core's own code. This fails the moment core changes and the bundle was not rebuilt, so
// the server never runs older rules than the CLI and the MCP server.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildFixEngine, ENGINE_EXPORTS, ENGINE_FILE } from '../../../../scripts/build-fix-engine.mjs';

describe('the fix engine bundle', () => {
  it('is what core builds today (run node scripts/build-fix-engine.mjs when this fails)', async () => {
    const built = await buildFixEngine();
    expect(readFileSync(ENGINE_FILE, 'utf8') === built).toBe(true);
  }, 30000);

  it('loads as a plain ES module with no import, and types every export it has', async () => {
    const text = readFileSync(ENGINE_FILE, 'utf8');
    expect(text).not.toMatch(/^import\s/m);
    expect(text).not.toMatch(/\brequire\(/);
    const mod = (await import('../../api/_lib/fix-engine.gen.js')) as Record<string, unknown>;
    expect(Object.keys(mod).sort()).toEqual([...ENGINE_EXPORTS].sort());
    const dts = readFileSync(join(ENGINE_FILE, '..', 'fix-engine.gen.d.ts'), 'utf8');
    for (const name of ENGINE_EXPORTS) expect(dts).toMatch(new RegExp(`\\b${name},`));
  });
});
