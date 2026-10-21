import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  fetchStorybookIndex,
  normalizeStorybookUrl,
  parseStorybookIndex,
  storybookIframeUrl,
  storybookManagerUrl,
  StorybookIndexError,
  type StorybookFetch,
} from '../src/storybook';

// Shapes taken from deployed Storybooks (spike 2026-10-21): v5 = Storybook 8+/10, v4 = 7, v3 = stories.json.
const V5 = {
  v: 5,
  entries: {
    'foundations-tokens--color': { type: 'story', subtype: 'story', id: 'foundations-tokens--color', name: 'Color', title: 'Foundations/Tokens', importPath: './packages/react/src/stories/Foundations.stories.tsx', tags: ['dev', 'test', 'manifest'], exportName: 'Color' },
    'forms-button--primary': { type: 'story', subtype: 'story', id: 'forms-button--primary', name: 'Primary', title: 'Forms/Button', importPath: './src/Button.stories.tsx', componentPath: './src/Button.tsx', tags: ['dev', 'autodocs'], exportName: 'Primary' },
    'forms-button--docs': { type: 'docs', id: 'forms-button--docs', name: 'Docs', title: 'Forms/Button', importPath: './src/Button.stories.tsx', storiesImports: [], tags: ['dev', 'autodocs'] },
    'forms-button--keyboard': { type: 'story', subtype: 'test', id: 'forms-button--keyboard', name: 'Keyboard', title: 'Forms/Button', importPath: './src/Button.stories.tsx', tags: ['test'] },
    'forms-button--secondary': { type: 'story', subtype: 'story', id: 'forms-button--secondary', name: 'Secondary', title: 'Forms/Button', importPath: './src/Button.stories.tsx', tags: ['dev'], exportName: 'Secondary' },
  },
};
const V4 = {
  v: 4,
  entries: {
    'intro--docs': { id: 'intro--docs', title: 'Intro', name: 'Docs', importPath: './src/Intro.mdx', storiesImports: [], type: 'docs', tags: ['unattached-mdx', 'docs'] },
    'avatar--large': { id: 'avatar--large', title: 'Avatar', name: 'Large', importPath: './src/Avatar.stories.tsx', type: 'story', tags: ['story'] },
  },
};
const V3 = {
  v: 3,
  stories: {
    'intro--docs': { id: 'intro--docs', title: 'Intro', name: 'Docs', importPath: './src/Intro.mdx', kind: 'Intro', story: 'Docs', parameters: { __id: 'intro--docs', docsOnly: true, fileName: './src/Intro.mdx' } },
    'addon-actions--action-only': { id: 'addon-actions--action-only', kind: 'Addon/Actions', story: 'Action only', importPath: './src/stories/addon-actions.stories.js', parameters: { docsOnly: false } },
  },
};

test('v5 index: groups by title, splits docs, keeps test entries out of stories', () => {
  const idx = parseStorybookIndex(V5);
  assert.equal(idx.version, 5);
  assert.equal(idx.source, 'index.json');
  assert.equal(idx.entries.length, 5);
  assert.deepEqual(idx.components.map((c) => c.title), ['Forms/Button', 'Foundations/Tokens']);
  const button = idx.components[0]!;
  assert.equal(button.name, 'Button');
  assert.deepEqual(button.group, ['Forms']);
  assert.deepEqual(button.stories.map((s) => s.id), ['forms-button--primary', 'forms-button--secondary']);
  assert.deepEqual(button.docs.map((s) => s.id), ['forms-button--docs']);
  assert.deepEqual(button.tags, ['autodocs', 'dev', 'test']);
  assert.equal(button.stories[0]!.componentPath, './src/Button.tsx');
  assert.equal(idx.entries.find((e) => e.id === 'forms-button--keyboard')!.subtype, 'test');
});

test('v4 index: docs-only pages are their own entry, root titles have no group', () => {
  const idx = parseStorybookIndex(V4);
  assert.equal(idx.version, 4);
  const intro = idx.components.find((c) => c.title === 'Intro')!;
  assert.equal(intro.stories.length, 0);
  assert.equal(intro.docs.length, 1);
  assert.deepEqual(idx.components.find((c) => c.title === 'Avatar')!.group, []);
});

test('v3 stories.json: kind/story fallbacks and docsOnly', () => {
  const idx = parseStorybookIndex(V3);
  assert.equal(idx.version, 3);
  assert.equal(idx.source, 'stories.json');
  const intro = idx.entries.find((e) => e.id === 'intro--docs')!;
  assert.equal(intro.type, 'docs');
  const action = idx.entries.find((e) => e.id === 'addon-actions--action-only')!;
  assert.equal(action.title, 'Addon/Actions');
  assert.equal(action.name, 'Action only');
  assert.equal(action.type, 'story');
});

test('rejects non-indexes with a reason', () => {
  const code = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      assert.ok(e instanceof StorybookIndexError);
      return e.code;
    }
    return 'none';
  };
  assert.equal(code(() => parseStorybookIndex('<html>')), 'not-json');
  assert.equal(code(() => parseStorybookIndex({ loginUrl: 'https://www.chromatic.com/custom-domain-verify' })), 'private');
  assert.equal(code(() => parseStorybookIndex({ v: 5, entries: {} })), 'empty');
  assert.equal(code(() => parseStorybookIndex({ v: 5, entries: { x: { id: 'x' } } })), 'empty');
});

test('normalizeStorybookUrl keeps the base and refuses non-https', () => {
  assert.equal(normalizeStorybookUrl(' https://sb.example.com/ '), 'https://sb.example.com');
  assert.equal(normalizeStorybookUrl('https://sb.example.com/?path=/story/forms-button--primary'), 'https://sb.example.com');
  assert.equal(normalizeStorybookUrl('https://primer.style/react/storybook/index.html'), 'https://primer.style/react/storybook');
  assert.equal(normalizeStorybookUrl('https://x.chromatic.com/iframe.html?id=a--b'), 'https://x.chromatic.com');
  assert.equal(normalizeStorybookUrl('https://x.example.com/sb/index.json'), 'https://x.example.com/sb');
  assert.equal(normalizeStorybookUrl('http://localhost:6006'), 'http://localhost:6006');
  assert.throws(() => normalizeStorybookUrl('http://sb.example.com'), /https/);
  assert.throws(() => normalizeStorybookUrl('sb.example.com'), StorybookIndexError);
  assert.throws(() => normalizeStorybookUrl('https://u:p@sb.example.com'), StorybookIndexError);
});

test('iframe and manager URLs', () => {
  assert.equal(storybookIframeUrl('https://sb.example.com/', 'forms-button--primary'), 'https://sb.example.com/iframe.html?id=forms-button--primary&viewMode=story');
  assert.equal(
    storybookIframeUrl('https://sb.example.com', 'a--b', { globals: { brand: 'ocean', theme: 'dark' }, args: { label: 'Save now' } }),
    'https://sb.example.com/iframe.html?id=a--b&viewMode=story&globals=brand:ocean;theme:dark&args=label:Save%20now',
  );
  assert.equal(storybookIframeUrl('https://sb.example.com', 'a--docs', { viewMode: 'docs' }), 'https://sb.example.com/iframe.html?id=a--docs&viewMode=docs');
  assert.equal(storybookManagerUrl('https://sb.example.com', 'a--b'), 'https://sb.example.com/?path=/story/a--b');
  assert.equal(storybookManagerUrl('https://sb.example.com', 'a--docs', 'docs'), 'https://sb.example.com/?path=/docs/a--docs');
});

type Answer = { status: number; body: string } | Error;
const fakeFetch = (answers: Record<string, Answer>): { fetch: StorybookFetch; calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    fetch: async (url) => {
      calls.push(url);
      const a = answers[url] ?? { status: 404, body: 'Not found' };
      if (a instanceof Error) throw a;
      return { ok: a.status >= 200 && a.status < 300, status: a.status, headers: { get: () => null }, text: async () => a.body };
    },
  };
};

test('fetchStorybookIndex: index.json first', async () => {
  const f = fakeFetch({ 'https://sb.example.com/index.json': { status: 200, body: JSON.stringify(V5) } });
  const idx = await fetchStorybookIndex('https://sb.example.com', { fetch: f.fetch });
  assert.equal(idx.source, 'index.json');
  assert.deepEqual(f.calls, ['https://sb.example.com/index.json']);
});

test('fetchStorybookIndex: falls back to stories.json on 404 and on an HTML answer', async () => {
  const a = fakeFetch({ 'https://sb.example.com/stories.json': { status: 200, body: JSON.stringify(V3) } });
  assert.equal((await fetchStorybookIndex('https://sb.example.com', { fetch: a.fetch })).source, 'stories.json');
  const b = fakeFetch({ 'https://sb.example.com/index.json': { status: 200, body: '<!doctype html><title>App</title>' }, 'https://sb.example.com/stories.json': { status: 200, body: JSON.stringify(V3) } });
  assert.equal((await fetchStorybookIndex('https://sb.example.com', { fetch: b.fetch })).version, 3);
});

test('fetchStorybookIndex: reports the most telling failure', async () => {
  const reject = async (answers: Record<string, Answer>) => {
    try {
      await fetchStorybookIndex('https://sb.example.com', { fetch: fakeFetch(answers).fetch });
    } catch (e) {
      assert.ok(e instanceof StorybookIndexError);
      return e.code;
    }
    return 'none';
  };
  assert.equal(await reject({}), 'not-found');
  assert.equal(await reject({ 'https://sb.example.com/stories.json': { status: 200, body: '<html>' } }), 'not-json');
  const login = JSON.stringify({ loginUrl: 'https://www.chromatic.com/custom-domain-verify' });
  assert.equal(await reject({ 'https://sb.example.com/index.json': { status: 200, body: login }, 'https://sb.example.com/stories.json': { status: 200, body: login } }), 'private');
  assert.equal(await reject({ 'https://sb.example.com/index.json': { status: 401, body: '' } }), 'private');
  assert.equal(await reject({ 'https://sb.example.com/index.json': new TypeError('Failed to fetch'), 'https://sb.example.com/stories.json': new TypeError('Failed to fetch') }), 'network');
  assert.equal(await reject({ 'https://sb.example.com/index.json': { status: 500, body: '' } }), 'http');
});
