import { describe, expect, it } from 'vitest';
import { acceptDocsText, formatDocsJson, type ComponentDocsJson } from '@bridge-ds/core';
import { cleanDocs, docsEdits, docsNotesForTokens, docsProposal, docsText, draftSummary, dropDocsEdits, setDocsEdit, tokenEdits, validateDocs } from './docs-draft-model';
import { draftSlug, draftToChanges, trayRows, type Draft } from './editor-model';

const docs = (over: Partial<ComponentDocsJson> = {}): ComponentDocsJson => ({
  summary: 'Shows a glyph.',
  whenToUse: ['Next to a label.'],
  whenNotToUse: [],
  dos: [],
  donts: [],
  accessibility: ['Decorative by default.'],
  ...over,
});
const path = 'packages/react/src/components/Icon/Icon.docs.json';
const valueEdit = { kind: 'value' as const, id: 'v1', path: 'color.text.muted', mode: 'light', before: '{a}', after: '{b}' };

describe('docs edits in the shared draft', () => {
  it('adds, replaces and drops a docs edit next to token edits', () => {
    let d: Draft = { edits: [valueEdit] };
    d = setDocsEdit(d, { path, component: 'Icon', slug: 'icon', before: null, after: docsText(docs()) });
    d = setDocsEdit(d, { path, component: 'Icon', slug: 'icon', before: null, after: docsText(docs({ summary: 'Changed.' })) });
    expect(docsEdits(d)).toHaveLength(1);
    expect(JSON.parse(docsEdits(d)[0]!.after).summary).toBe('Changed.');
    expect(tokenEdits(d)).toEqual([valueEdit]);
    expect(draftSummary(d)).toBe('1 token edit and 1 docs edit');
    // Back to the original text: nothing left to propose.
    const original = docsText(docs());
    expect(docsEdits(setDocsEdit(d, { path, component: 'Icon', slug: 'icon', before: original, after: original }))).toHaveLength(0);
    expect(dropDocsEdits(d).edits).toEqual([valueEdit]);
  });

  it('token code ignores docs edits: no token change, a tray row, the slug from the token edit', () => {
    const d = setDocsEdit({ edits: [] }, { path, component: 'Icon', slug: 'icon', before: null, after: docsText(docs()) });
    expect(draftToChanges({ byPath: new Map() } as never, d)).toEqual([]);
    expect(trayRows({ byPath: new Map() } as never, { byPath: new Map() } as never, d)[0]).toMatchObject({ label: 'Icon docs', context: 'docs' });
    expect(draftSlug({ edits: [...d.edits, valueEdit] })).toBe('color-text-muted');
  });

  it('validates the Bridge voice and empty items, and cleans before saving', () => {
    expect(validateDocs(docs())).toEqual([]);
    expect(validateDocs(docs({ summary: ' ' })).map((i) => i.field)).toEqual(['summary']);
    expect(validateDocs(docs({ whenToUse: ['Use it — always.'] })).map((i) => i.field)).toEqual(['voice']);
    expect(validateDocs(docs({ dos: [{ title: 'x', text: '' }] })).map((i) => i.field)).toEqual(['dos.0']);
    const cleaned = cleanDocs(docs({ whenToUse: [' a ', ''], anatomy: { icon: 'Glyph', empty: ' ' } }));
    expect(cleaned.whenToUse).toEqual(['a']);
    expect(cleaned.anatomy).toEqual({ icon: 'Glyph' });
  });
});

describe('docs proposal', () => {
  it('is Tier 1 with a patch changeset, one file per edit', () => {
    const d = setDocsEdit({ edits: [] }, { path, component: 'Icon', slug: 'icon', before: null, after: docsText(docs()) });
    const p = docsProposal(docsEdits(d), { date: new Date('2026-10-17T10:00:00Z') });
    expect(p.risk.tier).toBe(1);
    expect(p.bump).toBe('patch');
    expect(p.labels).toContain('tier-1');
    expect(p.title).toBe('docs(icon): usage guidance for Icon');
    expect(p.branch.startsWith('docs/icon-20261017-')).toBe(true);
    expect(p.files.map((f) => f.path)).toEqual([path, expect.stringMatching(/^\.changeset\/docs-icon-.+\.md$/)]);
    expect(p.files[1]!.content).toContain('"@bridge-ds/react": patch');
    expect(p.body).toContain('Tier 1');
    expect(p.body).toContain('still missing: whenNotToUse, dos, donts, contentGuidelines');
    expect(p.body).not.toMatch(/—/);
  });

  it('refuses an empty set', () => {
    expect(() => docsProposal([], { date: new Date() })).toThrow(/No docs edits/);
  });
});

describe('Claude drafts', () => {
  it('Accept sets needsReview false and keeps who drafted it', () => {
    const text = formatDocsJson({ ...docs(), draftedBy: 'claude', needsReview: true });
    const accepted = JSON.parse(acceptDocsText(text));
    expect(accepted).toMatchObject({ draftedBy: 'claude', needsReview: false });
  });
});

describe('docs notes on a token change', () => {
  it('lists each component that paints with a changed token, once', () => {
    const used: Record<string, string[]> = { 'color.a': ['Button', 'Link'], 'color.b': ['Button'] };
    const md = docsNotesForTokens(['color.a', 'color.b', 'color.c'], (p) => used[p] ?? []);
    expect(md).toContain('## Docs to check');
    expect(md).toContain('- Button: 2 tokens changed (color.a, color.b).');
    expect(md).toContain('- Link: token color.a changed.');
    expect(docsNotesForTokens(['color.c'], () => [])).toBe('');
  });
});
