// A throwaway git repo with a small, known token history on top of the real tokens:
//   init                       every token (a bulk import)
//   #3  Darken muted text      color.text.muted (light) neutral.600 -> neutral.700, with a changeset
//   #5  Add subtle text        color.text.subtle added in light and dark (merge commit of a branch)
//   tag v0.2.0
//   #7  Muted text even darker color.text.muted (light) neutral.700 -> neutral.800 (makes reverting #3 conflict)
//   #8  Rename link text       color.text.link -> color.text.anchor (squash)
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { LayeredTokenSet } from '../src/layered';
import { applyTokenEdits, type TokenEdit } from '../src/token-edits';
import { realChecksText, realConfig, realFiles } from './helpers';

export const ROOT = 'packages/tokens/src';
export const LIGHT = 'semantic/light.tokens.json';
export const DARK = 'semantic/dark.tokens.json';

export interface Fixture {
  dir: string;
  sha: Record<'init' | 'pr3' | 'pr5' | 'pr5branch' | 'pr7' | 'pr8', string>;
  /** Token files at HEAD (relative to the tokens root). */
  head: Map<string, string>;
  git(...args: string[]): string;
}

export function historyFixture(): Fixture {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-history-'));
  let clock = Date.parse('2026-09-01T10:00:00Z');
  const g = (...args: string[]) => {
    clock += 3600_000;
    const date = new Date(clock).toISOString();
    return execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
  };
  const write = (rel: string, text: string) => {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  };
  const config = realConfig();
  let files = new Map(Object.entries(realFiles()));
  // Pin the fixture's starting value: the real one may change in Studio at any time, and the history below
  // (600 -> 700 -> 800) must stay a real change whatever main says today.
  files = applyTokenEdits(new LayeredTokenSet(config, files), [{ op: 'set', path: 'color.text.muted', value: '{palette.neutral.600}', file: LIGHT }]).files;
  const writeTokens = () => {
    for (const [f, text] of files) write(`${ROOT}/${f}`, text);
  };
  const edit = (edits: TokenEdit[]) => {
    files = applyTokenEdits(new LayeredTokenSet(config, files), edits).files;
    writeTokens();
  };
  const sha = () => g('rev-parse', 'HEAD').trim();

  g('init', '-q', '-b', 'main');
  g('config', 'user.name', 'Ada');
  g('config', 'user.email', 'ada@example.com');
  const raw = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../bridge.config.json'), 'utf8'));
  write('bridge.config.json', JSON.stringify({ ...raw, repo: { owner: 'acme', name: 'ds', defaultBranch: 'main' } }, null, 2));
  write(`${ROOT}/contrast.checks.json`, realChecksText());
  write('packages/tokens/package.json', JSON.stringify({ name: '@bridge-ds/tokens', version: '0.2.0' }, null, 2));
  write('.changeset/README.md', 'Changesets.\n');
  writeTokens();
  g('add', '-A');
  g('commit', '-q', '-m', 'chore: initial tokens');
  const init = sha();

  edit([{ op: 'set', path: 'color.text.muted', value: '{palette.neutral.700}', file: LIGHT }]);
  write('.changeset/darken-muted.md', '---\n"@bridge-ds/tokens": minor\n---\n\nMuted text was too light on subtle surfaces; darken it one step in light.\n');
  g('add', '-A');
  g('commit', '-q', '-m', 'feat(tokens): darken muted text (#3)');
  const pr3 = sha();

  g('checkout', '-q', '-b', 'feature/subtle');
  edit([
    { op: 'add', path: 'color.text.subtle', value: '{palette.neutral.500}', file: LIGHT },
    { op: 'add', path: 'color.text.subtle', value: '{palette.neutral.400}', file: DARK },
  ]);
  g('add', '-A');
  g('commit', '-q', '-m', 'feat(tokens): add subtle text');
  const pr5branch = sha();
  g('checkout', '-q', 'main');
  g('merge', '-q', '--no-ff', 'feature/subtle', '-m', 'Merge pull request #5 from acme/feature/subtle', '-m', 'Add subtle text token');
  const pr5 = sha();
  g('tag', 'v0.2.0');

  edit([{ op: 'set', path: 'color.text.muted', value: '{palette.neutral.800}', file: LIGHT }]);
  g('add', '-A');
  g('commit', '-q', '-m', 'fix(tokens): muted text even darker (#7)');
  const pr7 = sha();

  edit([{ op: 'rename', path: 'color.text.link', newPath: 'color.text.anchor' }]);
  g('add', '-A');
  g('commit', '-q', '-m', 'feat(tokens)!: rename link text to anchor (#8)');
  const pr8 = sha();

  return { dir, sha: { init, pr3, pr5, pr5branch, pr7, pr8 }, head: files, git: (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' }) };
}
