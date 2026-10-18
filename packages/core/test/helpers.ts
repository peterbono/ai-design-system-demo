import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config';
import { buildTokenSet, layoutOptions } from '../src/token-set';
import type { LogicalToken } from '../src/types';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
/** This repo's bridge.config.json: tests read the real token files through it. */
export const realConfig = () => loadConfig(readFileSync(join(REPO_ROOT, 'bridge.config.json'), 'utf8'));
export const TOKENS_DIR = join(REPO_ROOT, realConfig().tokens.root);

/** Every *.tokens.json under the tokens root, keyed by path relative to it. */
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

/** The contrast checks file named in bridge.config.json: the one source of contrast pairs. */
export const realChecksText = () => readFileSync(join(TOKENS_DIR, realConfig().tokens.contrastChecks), 'utf8');

export const realSet = () => buildTokenSet(realFiles(), layoutOptions(realConfig()));

/**
 * The first choice that differs from a real token's current value. Tests read the live tokens, which a
 * designer may change in Studio at any time: derive an edit from the current value, never hard-code it.
 */
export const otherThan = <T>(current: unknown, ...choices: T[]): T => {
  const found = choices.find((c) => JSON.stringify(c) !== JSON.stringify(current));
  if (found === undefined) throw new Error('otherThan: every choice equals the current value');
  return found;
};

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
