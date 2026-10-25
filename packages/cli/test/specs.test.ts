// bridge specs --measure, with the browser and the network injected: story selection, the file written, the summary,
// and the usage errors. The measure itself is tested in packages/core/test/measure*.test.ts.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runSpecs, type MeasuredSpecsFile, type OpenPage } from '../src/specs.js';
import type { RequestArgs, RequestIO } from '../src/request.js';

const INDEX = {
  v: 5,
  entries: {
    'actions-button--primary': { id: 'actions-button--primary', title: 'Actions/Button', name: 'Primary', type: 'story', importPath: 'b' },
    'actions-button--ghost': { id: 'actions-button--ghost', title: 'Actions/Button', name: 'Ghost', type: 'story', importPath: 'b' },
    'forms-input--default': { id: 'forms-input--default', title: 'Forms/Input', name: 'Default', type: 'story', importPath: 'i' },
  },
};

const io = () => {
  const lines: string[] = [];
  const errors: string[] = [];
  const value: RequestIO = {
    print: (s) => void lines.push(s),
    error: (s) => void errors.push(s),
    env: {},
    fetch: (async (url: string) => {
      const found = String(url).endsWith('/index.json');
      return { ok: found, status: found ? 200 : 404, headers: { get: () => 'application/json' }, text: async () => JSON.stringify(INDEX) };
    }) as unknown as typeof fetch,
    ghToken: () => undefined,
    hasClaude: () => false,
  } as RequestIO;
  return { value, lines, errors };
};

const args = (...argv: string[]): RequestArgs => {
  const a: RequestArgs = { _: ['specs'], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]!.slice(2);
    const v = argv[i + 1] && !argv[i + 1]!.startsWith('--') ? argv[++i]! : 'true';
    (a.flags[k] ??= []).push(v);
  }
  return a;
};

// A page that "renders" a button for every story but the input, which never renders.
const fakeOpen = (): { open: OpenPage; urls: string[]; closed: () => boolean } => {
  const urls: string[] = [];
  let closed = false;
  let current = '';
  return {
    urls,
    closed: () => closed,
    open: async () => ({
      page: {
        goto: async (url: string) => {
          urls.push(url);
          current = url;
        },
        evaluate: async <T>(expr: string) => {
          if (expr.includes('async () =>')) return (current.includes('forms-input') ? 'timeout' : 'rendered') as T;
          if (current.includes('forms-input')) return { root: null, portals: [], wrappers: 0, nodes: 0, rules: 0, sheets: { read: 0, blocked: 0 }, rootVariables: 0, viewport: { width: 0, height: 0 } } as T;
          return {
            root: {
              tag: 'button',
              kind: 'frame',
              box: { x: 0, y: 0, width: 96, height: 36 },
              style: { display: 'inline-flex', 'flex-direction': 'row', 'background-color': 'rgb(1, 2, 3)', 'padding-left': '12px' },
              tokens: { 'background-color': { via: 'declared', chain: ['--button-bg'], exact: true } },
              children: [{ tag: 'span', kind: 'text', text: 'Save', box: { x: 12, y: 8, width: 30, height: 20 }, style: {}, tokens: {}, children: [] }],
            },
            portals: [],
            wrappers: 1,
            nodes: 2,
            rules: 10,
            sheets: { read: 1, blocked: 0 },
            rootVariables: 4,
            viewport: { width: 1200, height: 800 },
          } as T;
        },
      },
      close: async () => {
        closed = true;
      },
    }),
  };
};

describe('bridge specs --measure', () => {
  it('measures the first stories of each component and writes them in the specs shape', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bridge-test-measure-'));
    const o = io();
    const b = fakeOpen();
    const code = await runSpecs(args('--measure', '--storybook', 'https://sb.example.com/?path=/story/x', '--per', '1', '--out', 'm.json'), dir, o.value, b.open);
    expect(code).toBe(0);
    expect(b.urls).toEqual(['https://sb.example.com/iframe.html?id=actions-button--primary&viewMode=story', 'https://sb.example.com/iframe.html?id=forms-input--default&viewMode=story']);
    expect(b.closed()).toBe(true);
    const file = JSON.parse(readFileSync(join(dir, 'm.json'), 'utf8')) as MeasuredSpecsFile;
    expect(file.storybook).toBe('https://sb.example.com');
    const [button, input] = file.stories;
    expect(button!.spec!.values.root).toMatchObject({ fill: 'button.bg', paddingLeft: 12, width: 96, height: 36 });
    expect(button!.spec!.parts.map((p) => p.kind)).toEqual(['frame', 'text']);
    expect(input).toMatchObject({ id: 'forms-input--default', error: expect.stringContaining('did not render') });
    expect(o.lines.at(-1)).toMatch(/^Measured 1 of 2 stories, 1 of \d+ values tied to tokens\. .*m\.json$/);
  });

  it('takes --only and --stories', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bridge-test-measure-'));
    const b = fakeOpen();
    await runSpecs(args('--measure', '--storybook', 'https://sb.example.com', '--only', 'Button', '--json'), dir, io().value, b.open);
    expect(b.urls.map((u) => /id=([^&]+)/.exec(u)![1])).toEqual(['actions-button--primary', 'actions-button--ghost']);
    const c = fakeOpen();
    await runSpecs(args('--measure', '--storybook', 'https://sb.example.com', '--stories', 'actions-button--ghost'), dir, io().value, c.open);
    expect(c.urls).toHaveLength(1);
  });

  it('explains what is missing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bridge-test-measure-'));
    await expect(runSpecs(args(), dir, io().value)).rejects.toThrow(/needs --measure/);
    await expect(runSpecs(args('--measure'), dir, io().value)).rejects.toThrow(/needs --storybook/);
    await expect(runSpecs(args('--measure', '--storybook', 'http://sb.example.com'), dir, io().value)).rejects.toThrow(/https/);
    await expect(runSpecs(args('--measure', '--storybook', 'https://sb.example.com', '--per', '0'), dir, io().value)).rejects.toThrow(/--per/);
    const o = io();
    expect(await runSpecs(args('--measure', '--storybook', 'https://sb.example.com', '--only', 'Nope'), dir, o.value, fakeOpen().open)).toBe(2);
    expect(o.errors[0]).toContain('no story to measure');
  });

  it('--check compares with the Figma side it is given, and is skipped without one', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bridge-test-measure-'));
    const o = io();
    await runSpecs(args('--measure', '--storybook', 'https://sb.example.com', '--per', '1', '--check', '--out', 'm.json'), dir, o.value, fakeOpen().open);
    expect((JSON.parse(readFileSync(join(dir, 'm.json'), 'utf8')) as MeasuredSpecsFile).statuses).toBeUndefined();
    expect(o.lines).toContain('--check skipped: no Figma side to compare with.');
    writeFileSync(join(dir, 'specs.json'), JSON.stringify({ components: [{ name: 'Button', axes: [], properties: [], parts: [{ id: 'root', name: 'Root', kind: 'frame' }], variants: [{ props: {}, values: { root: {} } }] }] }));
    const o2 = io();
    await runSpecs(args('--measure', '--storybook', 'https://sb.example.com', '--per', '1', '--check', '--specs', 'specs.json', '--out', 'm.json'), dir, o2.value, fakeOpen().open);
    const file = JSON.parse(readFileSync(join(dir, 'm.json'), 'utf8')) as MeasuredSpecsFile;
    expect(file.statuses?.map((s) => [s.name, s.status, s.reason])).toEqual([
      ['Button', 'matches', undefined],
      ['Input', 'cant-check', 'did-not-render'],
    ]);
    expect(o2.lines).toContain("1 of 2 components match Figma. 0 differ, 1 can't be checked yet.");
    await expect(runSpecs(args('--measure', '--storybook', 'https://sb.example.com', '--check', '--specs', 'nope.json'), dir, io().value)).rejects.toThrow(/no file/);
    await expect(runSpecs(args('--measure', '--storybook', 'https://sb.example.com', '--states', 'hover,pressed'), dir, io().value)).rejects.toThrow(/--states/);
  });

  it('writes after each component and --resume measures only what is left', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bridge-test-measure-'));
    await runSpecs(args('--measure', '--storybook', 'https://sb.example.com', '--per', '1', '--out', 'm.json'), dir, io().value, fakeOpen().open);
    const first = JSON.parse(readFileSync(join(dir, 'm.json'), 'utf8')) as MeasuredSpecsFile;
    expect(first.done).toEqual(['Actions/Button', 'Forms/Input']);
    const again = fakeOpen();
    await runSpecs(args('--measure', '--storybook', 'https://sb.example.com', '--per', '1', '--out', 'm.json', '--resume'), dir, io().value, again.open);
    expect(again.urls).toEqual([]);
    expect((JSON.parse(readFileSync(join(dir, 'm.json'), 'utf8')) as MeasuredSpecsFile).stories).toHaveLength(2);
  });
});

