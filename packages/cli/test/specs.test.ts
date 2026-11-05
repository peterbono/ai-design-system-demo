// bridge specs --measure, with the browser and the network injected: story selection, the file written, the summary,
// and the usage errors. The measure itself is tested in packages/core/test/measure*.test.ts.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runSpecs, shotCrop, type MeasuredSpecsFile, type OpenPage } from '../src/specs.js';
import type { RequestArgs, RequestIO } from '../src/request.js';

const INDEX = {
  v: 5,
  entries: {
    'actions-button--primary': { id: 'actions-button--primary', title: 'Actions/Button', name: 'Primary', type: 'story', importPath: 'b' },
    'actions-button--ghost': { id: 'actions-button--ghost', title: 'Actions/Button', name: 'Ghost', type: 'story', importPath: 'b' },
    'forms-input--default': { id: 'forms-input--default', title: 'Forms/Input', name: 'Default', type: 'story', importPath: 'i' },
  },
};

const io = (index: object = INDEX) => {
  const lines: string[] = [];
  const errors: string[] = [];
  const value: RequestIO = {
    print: (s) => void lines.push(s),
    error: (s) => void errors.push(s),
    env: {},
    fetch: (async (url: string) => {
      const found = String(url).endsWith('/index.json');
      return { ok: found, status: found ? 200 : 404, headers: { get: () => 'application/json' }, text: async () => JSON.stringify(index) };
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


describe('bridge specs --measure --shots: a gallery', () => {
  it('cuts the shot of a story that shows several instances to the first one, the one the spec draws', async () => {
    const { decodePng, encodePng } = await import('@bridge-ds/visual');
    const { PNG } = await import('pngjs');
    const button = (x: number) => ({ tag: 'button', kind: 'frame', classes: ['btn'], box: { x, y: 0, width: 192, height: 56 }, style: { display: 'inline-flex', 'background-color': 'rgb(1, 2, 3)' }, tokens: {}, children: [{ tag: 'span', kind: 'text', text: 'Save', box: { x: x + 12, y: 18, width: 30, height: 20 }, style: {}, tokens: {}, children: [] }] });
    const result = { root: { tag: 'div', kind: 'frame', box: { x: 0, y: 0, width: 400, height: 56 }, style: { display: 'flex', 'flex-direction': 'row', 'column-gap': '16px' }, tokens: {}, children: [button(0), button(208)] }, portals: [], wrappers: 0, nodes: 5, rules: 1, sheets: { read: 1, blocked: 0 }, rootVariables: 0, viewport: { width: 1200, height: 800 } };
    const open: OpenPage = async () => ({
      page: {
        goto: async () => undefined,
        evaluate: async <T>(expr: string) => (expr.includes('async () =>') ? 'rendered' : expr.includes('"mark":true') ? { marked: true } : result) as T,
        // At 2x: the first instance red, the second blue.
        screenshot: async (_selector: string, file: string) => {
          const png = new PNG({ width: 800, height: 112 });
          for (let i = 0; i < png.data.length; i += 4) {
            const x = (i / 4) % 800;
            png.data.set(x < 384 ? [255, 0, 0, 255] : [0, 0, 255, 255], i);
          }
          mkdirSync(dirname(file), { recursive: true });
          writeFileSync(file, encodePng(png));
          return { width: 400, height: 56 };
        },
      },
      close: async () => undefined,
    });
    const dir = mkdtempSync(join(tmpdir(), 'bridge-test-gallery-'));
    expect(await runSpecs(args('--measure', '--storybook', 'https://sb.example.com', '--stories', 'actions-button--primary', '--shots', '--out', 'm.json'), dir, io().value, open)).toBe(0);
    const story = (JSON.parse(readFileSync(join(dir, 'm.json'), 'utf8')) as MeasuredSpecsFile).stories[0]!;
    expect(story.gallery).toBe(true);
    expect(story.shot).toMatchObject({ width: 192, height: 56 });
    const png = decodePng(readFileSync(join(dir, story.shot!.file)));
    expect([png.width, png.height]).toEqual([384, 112]);
    expect([...png.data.subarray(png.data.length - 4)]).toEqual([255, 0, 0, 255]);
  });
});

describe('bridge specs --measure --check: sets drawn under a folder', () => {
  it('writes Dialog/Popup as its own entries from the stories that show the popup, and checks it', async () => {
    const index = { v: 5, entries: { 'overlays-dialog--default': { id: 'overlays-dialog--default', title: 'Overlays/Dialog', name: 'Default', type: 'story', importPath: 'd' } } };
    // The story shows the popup (portaled, opened by the measure): a DialogContent of size md.
    const result = { root: { tag: 'div', kind: 'frame', classes: ['_popup_1a2b3_1', '_md_1a2b3_2'], box: { x: 0, y: 0, width: 560, height: 148 }, style: { display: 'flex', 'flex-direction': 'column', 'background-color': 'rgb(1, 2, 3)' }, tokens: { 'background-color': { via: 'declared', chain: ['--dialog-bg'], exact: true } }, children: [{ tag: 'h2', kind: 'text', text: 'Title', box: { x: 20, y: 20, width: 100, height: 28 }, style: {}, tokens: {}, children: [] }] }, portals: [], wrappers: 0, nodes: 2, rules: 1, sheets: { read: 1, blocked: 0 }, rootVariables: 1, viewport: { width: 1200, height: 800 } };
    const open: OpenPage = async () => ({ page: { goto: async () => undefined, evaluate: async <T>(expr: string) => (expr.includes('async () =>') ? 'rendered' : result) as T }, close: async () => undefined });
    const dir = mkdtempSync(join(tmpdir(), 'bridge-test-folder-'));
    const popup = { name: 'Dialog/Popup', component: 'Dialog', view: 'popup', axes: [{ name: 'Size', prop: 'size', values: ['sm', 'md', 'lg'], default: 'md' }], properties: [], parts: [{ id: 'root', name: 'Root', kind: 'frame', source: 'Dialog.module.css .popup, Dialog.module.css .md' }], variants: ['sm', 'md', 'lg'].map((v) => ({ props: { Size: v }, values: { root: {} } })) };
    writeFileSync(join(dir, 'specs.json'), JSON.stringify({ components: [popup] }));
    const o = io(index);
    expect(await runSpecs(args('--measure', '--storybook', 'https://sb.example.com', '--check', '--specs', 'specs.json', '--out', 'm.json'), dir, o.value, open)).toBe(0);
    const file = JSON.parse(readFileSync(join(dir, 'm.json'), 'utf8')) as MeasuredSpecsFile;
    const entry = file.stories.find((s) => s.set === 'Dialog/Popup');
    expect(entry).toMatchObject({ id: 'overlays-dialog--default', title: 'Overlays/Dialog/Popup', props: { size: 'md' } });
    expect(file.components!.find((c) => c.set === 'Dialog/Popup')).toMatchObject({ title: 'Overlays/Dialog/Popup', argTypes: { size: { kind: 'enum' } } });
    // The popup has its own status; the component itself, which Figma has no set of, has none.
    expect(file.statuses!.map((s) => s.name)).toEqual(['Dialog/Popup']);
    expect(file.statuses![0]!.variants.find((v) => v.key === 'Size=md')).toMatchObject({ story: 'overlays-dialog--default' });
  });
});

describe('shotCrop: the shot is the measured box, not the whole pixels around it', () => {
  it('cuts a 20 px badge on y 39.44 out of its 21 px tall shot (2x)', () => {
    expect(shotCrop({ x: 10, y: 39.44, width: 20, height: 20 }, 40, 42)).toEqual({ x: 0, y: 1, width: 40, height: 40 });
    expect(shotCrop({ x: 10.5, y: 39.44, width: 18, height: 18 }, 38, 38)).toEqual({ x: 1, y: 1, width: 36, height: 36 });
  });

  it('leaves a box on whole pixels as it is', () => {
    expect(shotCrop({ x: 0, y: 8, width: 96, height: 36 }, 192, 72)).toBeUndefined();
  });
});
