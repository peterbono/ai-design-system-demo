// bridge measure setup: writes the automatic measure workflow from the team's bridge.config.json (its deployed
// Storybook, its default branch, what changes the Storybook), the same file Studio opens as a pull request.
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { measureWorkflowYaml } from '@bridge-ds/core';
import { runMeasure } from '../src/measure.js';
import { RequestUsageError, type RequestArgs, type RequestIO } from '../src/request.js';

const io = () => {
  const lines: string[] = [];
  const value = { print: (s: string) => void lines.push(s), error: () => undefined, env: {}, ghToken: () => undefined, hasClaude: () => false } as unknown as RequestIO;
  return { value, lines, text: () => lines.join('\n') };
};
const args = (...argv: string[]): RequestArgs => {
  const a: RequestArgs = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i]!.startsWith('--')) {
      a._.push(argv[i]!);
      continue;
    }
    const k = argv[i]!.slice(2);
    const v = argv[i + 1] && !argv[i + 1]!.startsWith('--') ? argv[++i]! : 'true';
    (a.flags[k] ??= []).push(v);
  }
  return a;
};
const FILE = '.github/workflows/bridge-measure.yml';
const repo = (config?: unknown) => {
  const root = mkdtempSync(join(tmpdir(), 'bridge-test-measure-'));
  if (config) writeFileSync(join(root, 'bridge.config.json'), JSON.stringify(config));
  return root;
};
const config = {
  repo: { owner: 'acme', name: 'ds', defaultBranch: 'trunk' },
  tokens: { root: 'tokens' },
  components: { dir: 'src/components' },
  previews: { production: { storybook: 'https://storybook.acme.dev' } },
};

describe('bridge measure setup', () => {
  it('writes the workflow from bridge.config.json: the deployed Storybook, the default branch, what changes it', async () => {
    const root = repo(config);
    const o = io();
    expect(await runMeasure(args('measure', 'setup'), root, o.value)).toBe(0);
    const yaml = readFileSync(join(root, FILE), 'utf8');
    expect(yaml).toBe(measureWorkflowYaml({ defaultBranch: 'trunk', storybookUrl: 'https://storybook.acme.dev', paths: ['src/**', 'tokens/**', '.storybook/**', 'package.json', 'package-lock.json'] }));
    expect(yaml).toContain("STORYBOOK_URL: 'https://storybook.acme.dev'");
    expect(o.lines[0]).toBe(`Wrote ${FILE}: it measures your Storybook after each deploy of https://storybook.acme.dev.`);
    expect(o.text()).toMatch(/Actions, Bridge measure, Run workflow/);
  });

  it('--build: Storybook built in the run, on pushes to the default branch that change it', async () => {
    const root = repo(config);
    expect(await runMeasure(args('measure', 'setup', '--build', '--build-command', 'pnpm sb:build', '--dir', 'sb-out'), root, io().value)).toBe(0);
    const yaml = readFileSync(join(root, FILE), 'utf8');
    expect(yaml).toMatch(/push:\n    branches: \[trunk\]/);
    expect(yaml).toContain('run: pnpm sb:build');
    expect(yaml).toContain("--directory 'sb-out'");
  });

  it('keeps a workflow that is already there unless --force; --print writes nothing', async () => {
    const root = repo();
    const o = io();
    expect(await runMeasure(args('measure', 'setup', '--print'), root, o.value)).toBe(0);
    expect(existsSync(join(root, FILE))).toBe(false);
    expect(o.text()).toBe(measureWorkflowYaml());
    await runMeasure(args('measure', 'setup'), root, io().value);
    writeFileSync(join(root, FILE), 'name: mine\n');
    const kept = io();
    await runMeasure(args('measure', 'setup', '--storybook', 'https://sb.example.com'), root, kept.value);
    expect(kept.lines[0]).toMatch(/already there, kept as it is/);
    expect(readFileSync(join(root, FILE), 'utf8')).toBe('name: mine\n');
    await runMeasure(args('measure', 'setup', '--storybook', 'https://sb.example.com', '--force'), root, io().value);
    expect(readFileSync(join(root, FILE), 'utf8')).toContain("STORYBOOK_URL: 'https://sb.example.com'");
  });

  it('a Storybook address must be https; an unknown subcommand says what exists', async () => {
    await expect(runMeasure(args('measure', 'setup', '--storybook', 'http://sb.local'), repo(), io().value)).rejects.toThrow(RequestUsageError);
    await expect(runMeasure(args('measure', 'run'), repo(), io().value)).rejects.toThrow(/Did you mean bridge measure setup/);
    expect(await runMeasure(args('measure'), repo(), io().value)).toBe(2);
  });
});
