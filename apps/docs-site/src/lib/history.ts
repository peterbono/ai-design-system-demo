// Build-time history data for the History page and the token history panel: the real history of the token files
// read from local git (first parent of HEAD), and a separate demo history built over the current files. Both go to
// /history/data.json; the browser never mixes them. A shallow clone (CI, Vercel) or a missing git simply gives fewer
// real entries, and the page says so.
import {
  demoHistory,
  layoutOptions,
  loadConfig,
  parseContrastChecks,
  selectTokenFiles,
  type BridgeConfig,
  type HistoryEntry,
  type HistoryReport,
} from '@bridge/core';
import { loadLocalHistory, localGitHistoryBackend } from '@bridge/core/node';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { reviewTokenChange, type TokenReview } from './token-review';
import { demoBeforeFiles } from './history-view';
import { exists, git, readText, repoPath, ROOT } from './repo';

export interface HistoryData {
  generatedAt: string;
  config: unknown;
  /** Token files on the base branch as built, relative to tokens.root: the planner's "current main" without a token. */
  files: Record<string, string>;
  checks: string;
  real: HistoryReport | null;
  /** Why real history is missing or short, in plain words. */
  realNote: string | null;
  demo: HistoryReport;
  /** Designer diff per entry id (not for bulk imports), same shape as Reviews. Keyed `real:<id>` and `demo:<id>`. */
  reviews: Record<string, TokenReview>;
}

export function siteConfig(): BridgeConfig {
  return loadConfig(exists('bridge.config.json') ? readText('bridge.config.json') : '{}');
}

export function currentTokenFiles(config: BridgeConfig): Record<string, string> {
  const root = config.tokens.root.replace(/\/$/, '');
  const abs = repoPath(root);
  const all: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else all.push(relative(ROOT, full));
    }
  };
  if (exists(root)) walk(abs);
  const out: Record<string, string> = {};
  for (const f of selectTokenFiles(config, all)) out[f] = readText(`${root}/${f}`);
  return out;
}

let cached: Promise<HistoryData> | null = null;

export function historyData(): Promise<HistoryData> {
  cached ??= build();
  return cached;
}

async function build(): Promise<HistoryData> {
  const config = siteConfig();
  const files = currentTokenFiles(config);
  const checks = config.contrast && exists(config.contrast.path) ? readText(config.contrast.path) : '';
  const pairs = parseContrastChecks(checks || undefined);
  const opts = layoutOptions(config);
  const reviews: Record<string, TokenReview> = {};

  let real: HistoryReport | null = null;
  let realNote: string | null = null;
  try {
    real = await loadLocalHistory(ROOT, config, { limit: 60 });
    const shallow = git(['rev-parse', '--is-shallow-repository']) === 'true';
    if (shallow) realNote = 'This build ran on a shallow clone, so older changes may be missing.';
    const backend = localGitHistoryBackend(ROOT, config);
    for (const e of real.entries) {
      if (e.bulk || !e.baseSha) continue;
      const [before, after] = await Promise.all([backend.tokenFiles(e.baseSha), backend.tokenFiles(e.sha)]);
      reviews[`real:${e.id}`] = reviewTokenChange(Object.fromEntries(before), Object.fromEntries(after), pairs, opts);
    }
  } catch (err) {
    real = null;
    realNote = `Bridge could not read git history for this build (${(err as Error).message.split('\n')[0]}).`;
  }

  const demo = demoHistory(config, new Map(Object.entries(files)));
  // Demo states, rebuilt newest first: before = after with this entry's changes undone.
  let after: Record<string, string> = files;
  for (const e of demo.entries) {
    const before = demoBeforeFiles(config, after, e as HistoryEntry);
    reviews[`demo:${e.id}`] = reviewTokenChange(before, after, pairs, opts);
    after = before;
  }

  return { generatedAt: new Date().toISOString(), config: exists('bridge.config.json') ? JSON.parse(readText('bridge.config.json')) : {}, files, checks, real, realNote, demo, reviews };
}
