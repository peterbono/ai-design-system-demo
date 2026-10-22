// The Library libs are functions of a RepoModel: they never read the site's files or the build-time model, so a
// team's Library (in the browser) can call them with its own model.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = __dirname;
const sources = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));

describe('lib/library', () => {
  it.each(sources)('%s imports no Node API and not the build-time model', (file) => {
    const src = readFileSync(join(dir, file), 'utf8');
    const imports = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    expect(imports.filter((i) => i!.startsWith('node:') || i === '@bridge-ds/core/node' || /(^|\/)model$/.test(i!) && !i!.includes('explorer/'))).toEqual([]);
  });
});
