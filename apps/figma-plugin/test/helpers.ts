import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { buildTokenSet } from '../src/core/token-set';
import type { LogicalToken } from '../src/core/types';

export const TOKENS_DIR = join(process.cwd(), '../../packages/tokens/src');

/** Every *.tokens.json under packages/tokens/src, keyed by path relative to it. */
export function realFiles(): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.tokens.json')) out[relative(TOKENS_DIR, full)] = readFileSync(full, 'utf8');
    }
  };
  walk(TOKENS_DIR);
  return out;
}

export const realPairsText = () => readFileSync(join(TOKENS_DIR, 'contrast-pairs.json'), 'utf8');

export const realSet = () => buildTokenSet(realFiles());

export function clone(t: LogicalToken, patch: Partial<LogicalToken> = {}): LogicalToken {
  return { ...structuredClone(t), ...patch };
}

export function tok(path: string, values: Record<string, unknown>, extra: Partial<LogicalToken> = {}): LogicalToken {
  return {
    id: `path:${path}`,
    path,
    type: 'color',
    tier: 'value' in values ? 'primitive' : 'semantic',
    values,
    description: undefined,
    scopes: undefined,
    files: {},
    ...extra,
  };
}
