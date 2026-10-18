// Explorer data built in the browser from the JSON blocks ExplorerData.astro embeds (token files, config, contrast
// checks, build-time usage). Shared by the token explorer and the token detail drawer of the Library foundation pages,
// so both read the same token set, contrast results and usage.
import { buildTokenSet, contrastScope, evaluatePairs, layoutOptions, loadConfig, parseContrastChecks } from '@bridge-ds/core';
import { readsByComponent } from '../../lib/explorer/detail-summary';
import { buildTokens, modesOf, type UsageMap } from '../../lib/explorer/model';
import type { ExplorerData } from './types';

export function readJson<T>(id: string, fallback: T): T {
  const el = document.getElementById(id);
  if (!el?.textContent) return fallback;
  try {
    return JSON.parse(el.textContent) as T;
  } catch {
    return fallback;
  }
}

export function loadExplorerData(): ExplorerData {
  const files = readJson<Record<string, string>>('xp-files', {});
  const config = loadConfig(document.getElementById('xp-config')?.textContent || '{}');
  const head = buildTokenSet(files, layoutOptions(config));
  const pairs = parseContrastChecks(document.getElementById('xp-checks')?.textContent || undefined);
  const usage = readJson<UsageMap>('xp-usage', {});
  const results = evaluatePairs(head.byPath, pairs, contrastScope(head));
  const modes = modesOf(head);
  const tokens = buildTokens(head, usage);
  const reads = readsByComponent(readJson<Record<string, { name: string; paths: string[] }>>('xp-components', {}));
  return { set: head, head, tokens, byPath: new Map(tokens.map((t) => [t.path, t])), usage, pairs, results, before: [], modes, tokensRoot: config.tokens.root, reads };
}
