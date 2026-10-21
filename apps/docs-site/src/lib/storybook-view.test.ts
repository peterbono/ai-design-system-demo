// Storybook quick start words and rules (lib/storybook-view.ts) and the browser workspace (lib/workspace.ts).
import { describe, expect, it } from 'vitest';
import { parseStorybookIndex } from '@bridge-ds/core';
import {
  checkedAgo,
  CONNECT_REPO,
  filterStorybookRows,
  frameLine,
  LOCKED_LINE,
  rowFacts,
  shownTags,
  storybookErrorLine,
  storybookFamilies,
  storybookLead,
  storybookRows,
  TOP_LEVEL,
} from './storybook-view';
import { parseWorkspace, storybookHost } from './workspace';

const index = parseStorybookIndex({
  v: 5,
  entries: {
    'intro--docs': { type: 'docs', id: 'intro--docs', title: 'Intro', name: 'Docs', importPath: './Intro.mdx', tags: ['unattached-mdx'] },
    'forms-button--primary': { type: 'story', id: 'forms-button--primary', title: 'Forms/Button', name: 'Primary', importPath: './Button.stories.tsx', tags: ['dev', 'test', 'beta'] },
    'forms-button--secondary': { type: 'story', id: 'forms-button--secondary', title: 'Forms/Button', name: 'Secondary', importPath: './Button.stories.tsx', tags: ['dev'] },
    'forms-button--docs': { type: 'docs', id: 'forms-button--docs', title: 'Forms/Button', name: 'Docs', importPath: './Button.stories.tsx', tags: ['autodocs'] },
    'forms-input--default': { type: 'story', id: 'forms-input--default', title: 'Forms/Input', name: 'Default', importPath: './Input.stories.tsx' },
    'avatar--image': { type: 'story', id: 'avatar--image', title: 'Avatar', name: 'Image', importPath: './Avatar.stories.tsx' },
  },
});

describe('storybook rows', () => {
  it('one row per component with stories, docs-only pages apart', () => {
    const rows = storybookRows(index);
    expect(rows.map((r) => r.title)).toEqual(['Avatar', 'Forms/Button', 'Forms/Input']);
    expect(rows[1]).toMatchObject({ name: 'Button', family: 'Forms', stories: 2, docs: true, firstStory: 'forms-button--primary' });
    expect(storybookLead(index)).toBe('3 components, 4 stories and 1 docs page, read from your Storybook.');
    expect(rowFacts(rows[1]!)).toBe('2 stories, docs');
    expect(rowFacts(rows[0]!)).toBe('1 story');
  });

  it('families sorted, root rows last as Top level', () => {
    const rows = storybookRows(index);
    expect(storybookFamilies(rows)).toEqual([
      { name: 'Forms', n: 2 },
      { name: TOP_LEVEL, n: 1 },
    ]);
    expect(filterStorybookRows(rows, 'butt', '').map((r) => r.name)).toEqual(['Button']);
    expect(filterStorybookRows(rows, '', TOP_LEVEL).map((r) => r.name)).toEqual(['Avatar']);
    expect(filterStorybookRows(rows, 'forms', 'Forms').length).toBe(2);
  });

  it('shows the tags a team sets, not Storybook bookkeeping', () => {
    expect(shownTags(index.components.find((c) => c.title === 'Forms/Button')!)).toEqual(['beta']);
  });
});

describe('words', () => {
  it('says how to fix every read failure, in the Bridge voice', () => {
    const codes = ['invalid-url', 'not-found', 'not-json', 'private', 'empty', 'blocked', 'too-large', 'timeout', 'redirects', 'network', 'http'];
    for (const c of codes) {
      const line = storybookErrorLine(c);
      expect(line, c).toMatch(/^[A-Z].*\.$|https:\/\/$/);
      expect(line).not.toContain('—');
    }
    expect(storybookErrorLine('private')).toContain('connect the repository');
  });

  it('frames, locked line and the connect action', () => {
    expect(frameLine('allowed')).toBeNull();
    expect(frameLine('unknown')).toBeNull();
    expect(frameLine('blocked')).toContain('Open it in Storybook');
    expect(LOCKED_LINE).toBe('Tokens, contrast checks and suggestions need the repository connected.');
    expect(CONNECT_REPO.href).toBe('/studio/?setup=library');
  });

  it('checkedAgo', () => {
    const now = Date.parse('2026-10-21T12:00:00Z');
    expect(checkedAgo('2026-10-21T11:59:30Z', now)).toBe('Checked just now');
    expect(checkedAgo('2026-10-21T11:55:00Z', now)).toBe('Checked 5 minutes ago');
    expect(checkedAgo('2026-10-21T11:00:00Z', now)).toBe('Checked 1 hour ago');
    expect(checkedAgo('2026-10-19T12:00:00Z', now)).toBe('Checked 2 days ago');
  });
});

describe('workspace', () => {
  it('keeps a well-formed Storybook and drops the rest', () => {
    const ok = { storybook: { url: 'https://sb.example.com/', components: 3, stories: 4, checkedAt: '2026-10-21T10:00:00Z' } };
    expect(parseWorkspace(JSON.stringify(ok)).storybook).toEqual({ url: 'https://sb.example.com', components: 3, stories: 4, checkedAt: '2026-10-21T10:00:00Z' });
    expect(parseWorkspace(null).storybook).toBeNull();
    expect(parseWorkspace('not json').storybook).toBeNull();
    expect(parseWorkspace(JSON.stringify({ storybook: { url: 'javascript:alert(1)', components: 1, stories: 1 } })).storybook).toBeNull();
    expect(parseWorkspace(JSON.stringify({ storybook: { url: 'https://sb.example.com', components: -1, stories: 1 } })).storybook).toBeNull();
    expect(parseWorkspace(JSON.stringify({ storybook: { url: 'https://sb.example.com', components: 1, stories: 1, checkedAt: 'later' } })).storybook?.checkedAt).toBe('1970-01-01T00:00:00.000Z');
  });

  it('storybookHost keeps the path', () => {
    expect(storybookHost('https://primer.style/react/storybook')).toBe('primer.style/react/storybook');
    expect(storybookHost('https://sb.example.com')).toBe('sb.example.com');
  });
});
