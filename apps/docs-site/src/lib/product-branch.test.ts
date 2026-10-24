import { describe, expect, it } from 'vitest';
import { DEFAULT_PRODUCTS, libraryPreviewState, linkStatus, withNeededBy, type LinkedLibraryBranch, type MissingPiece, type PiecesRecord } from '@bridge-ds/core';
import { ASK_CLAUDE, childLine, developerLines, isProductBranch, libraryHref, nestLinked, pieceRows, productContextOf, productCrumbs, statusLine, whyItShows } from './product-branch';

const piece = (over: Partial<MissingPiece> = {}): MissingPiece => ({
  id: 'badge-overdue-tone',
  kind: 'variant',
  title: 'Badge: overdue tone',
  summary: 'Badge restyled by hand.',
  name: 'overdue',
  component: 'Badge',
  values: [
    { category: 'color', property: 'color', value: '#a3123a' },
    { category: 'color', property: 'background', value: '#fdecec' },
  ],
  where: [],
  ...over,
});

const linked = (over: Partial<LinkedLibraryBranch> = {}): LinkedLibraryBranch => ({
  link: { piece: 'badge-overdue-tone', kind: 'token-change', number: 40, url: 'u', title: 'Badge: overdue tone', branch: 'bridge/x', at: '' },
  piece: piece(),
  status: linkStatus({ kind: 'token-change', state: 'open', draft: false, requestedReviewers: ['dana'] }),
  preview: libraryPreviewState({ kind: 'token-change', lifecycle: 'open', hasChanges: true, missing: 0, total: 1, behindMain: null }),
  people: ['dana'],
  ...over,
});

describe('isProductBranch', () => {
  it('a product label other than the library makes a product branch', () => {
    expect(isProductBranch([{ name: 'exploration' }, { name: 'product: admin' }], DEFAULT_PRODUCTS)?.name).toBe('Admin demo');
    expect(isProductBranch(['product: library'], DEFAULT_PRODUCTS)).toBeNull();
    expect(isProductBranch([{ name: 'exploration' }], DEFAULT_PRODUCTS)).toBeNull();
    expect(isProductBranch(['product: unknown'], DEFAULT_PRODUCTS)).toBeNull();
    expect(isProductBranch(null, DEFAULT_PRODUCTS)).toBeNull();
  });
});

describe('rows', () => {
  it('the mockup row: Badge: overdue tone, In review · Dana reviews, the background as its value', () => {
    const record: PiecesRecord = { checkedAt: '', pieces: [piece()], links: [linked().link] };
    const rows = pieceRows({ record, linked: [linked()], names: { dana: 'Dana' } });
    expect(rows).toEqual([
      {
        id: 'badge-overdue-tone',
        title: 'Badge: overdue tone',
        value: '#fdecec',
        library: { href: '?pr=40', number: 40, line: 'In review · Dana reviews', tone: 'info', opens: 'pr' },
        action: null,
        preview: 'preview',
        previewSentence: expect.stringMatching(/^Your feature uses a preview/),
      },
    ]);
  });

  it('pieces without a library branch come after, with Send for review; nothing before a check', () => {
    const record: PiecesRecord = { checkedAt: '', pieces: [piece(), piece({ id: 'color-c2410c', title: 'New color #C2410C', values: [{ category: 'color', value: '#c2410c' }] })], links: [linked().link] };
    const rows = pieceRows({ record, linked: [linked()] });
    expect(rows.map((r) => [r.id, r.action?.label ?? null])).toEqual([
      ['badge-overdue-tone', null],
      ['color-c2410c', 'Send for review'],
    ]);
    expect(rows[0]!.library!.line).toBe('In review · @dana reviews');
    expect(pieceRows({ record: undefined, linked: [] })).toEqual([]);
  });

  it('a shipped library branch offers the switch, an outdated one the latest preview', () => {
    const shipped = linked({ status: linkStatus({ kind: 'token-change', state: 'merged', draft: false }), preview: libraryPreviewState({ kind: 'token-change', lifecycle: 'merged', hasChanges: true, missing: null, total: null, behindMain: 2 }) });
    const record: PiecesRecord = { checkedAt: '', pieces: [piece()], links: [shipped.link] };
    expect(pieceRows({ record, linked: [shipped] })[0]!.action).toEqual({ kind: 'switch', label: 'Switch to the published version' });
    const outdated = linked({ preview: libraryPreviewState({ kind: 'token-change', lifecycle: 'open', hasChanges: true, missing: 1, total: 2, behindMain: null }) });
    expect(pieceRows({ record, linked: [outdated] })[0]!.action?.kind).toBe('refresh-preview');
  });

  it('where each library branch opens', () => {
    expect(libraryHref({ kind: 'exploration', number: 4 })).toBe('?exploration=4');
    expect(libraryHref({ kind: 'exploration', number: 4 }, { key: 'exploring' })).toBe('?exploration=4');
    // Promoted to review: it opens as a branch in review.
    expect(libraryHref({ kind: 'exploration', number: 4 }, { key: 'in-review' })).toBe('?pr=4');
    expect(libraryHref({ kind: 'request', number: 101 })).toBe('?request=101');
    expect(libraryHref({ kind: 'suggestion', number: 42 })).toBe('?suggestion=42');
    expect(libraryHref({ kind: 'suggestion', number: 42 }, { key: 'in-review' })).toBe('?suggestion=42');
  });

  it('status lines name people and the right verb', () => {
    expect(statusLine({ key: 'changes', label: 'Changes requested', people: ['dana'] }, { dana: 'Dana' })).toBe('Changes requested · Dana asks');
    expect(statusLine({ key: 'in-review', label: 'In review', people: ['a', 'b', 'c'] }, { a: 'Ann' })).toBe('In review · Ann and 2 more review');
    expect(statusLine({ key: 'shipped', label: 'Shipped', people: [] })).toBe('Shipped');
  });
});

describe('why it already shows', () => {
  const rows = (keys: (Parameters<typeof libraryPreviewState>[0] | null)[]) =>
    keys.map((k, i) => ({ id: String(i), title: '', value: null, library: null, action: null, preview: k ? libraryPreviewState(k).key : null, previewSentence: null }));
  const base = { kind: 'token-change' as const, lifecycle: 'open' as const, hasChanges: true, missing: 0, total: 1, behindMain: null };

  it('the mockup text when the branch uses a preview', () => {
    expect(whyItShows(rows([base]))).toEqual({ title: 'Why it already shows in your screen', text: 'Your feature uses a preview of the library change. When the library publishes it, switch to the real version here in one click.' });
  });

  it('drawn by hand, published, switched, nothing', () => {
    expect(whyItShows(rows([null]))!.text).toMatch(/^Your feature draws it by hand for now/);
    expect(whyItShows(rows([{ ...base, lifecycle: 'merged', behindMain: 3 }]))!.text).toMatch(/^The library published it/);
    expect(whyItShows(rows([{ ...base, lifecycle: 'merged', behindMain: 0 }]))).toEqual({ title: 'Where it comes from', text: 'Your feature uses the published version from the library.' });
    expect(whyItShows([])).toBeNull();
  });
});

describe('page parts', () => {
  it('crumbs, developer lines and the ask', () => {
    expect(productCrumbs('Admin demo', 'DS-87', 'Billing')).toEqual([{ label: 'Changes', href: '/studio/changes/' }, { label: 'Admin demo', href: '/studio/changes/' }, { label: 'DS-87' }]);
    expect(productCrumbs('Admin demo', null, 'Billing').at(-1)).toEqual({ label: 'Billing' });
    expect(developerLines({ number: 12, branch: 'explore/billing', links: [{ kind: 'token-change', number: 40, branch: 'bridge/add-x' }, { kind: 'request', number: 101 }] })).toEqual([
      { label: 'Product branch', value: 'explore/billing (#12)' },
      { label: 'Library branch', value: 'bridge/add-x (#40)' },
      { label: 'Library request', value: '#101' },
      { label: 'Check it again', value: 'bridge pieces 12 --record' },
      { label: 'With Claude', value: 'bridge_missing_pieces { pr: 12, record: true }' },
    ]);
    expect(ASK_CLAUDE).not.toMatch(/\u2014/);
  });
});

describe('product context on the library review', () => {
  const body = withNeededBy('## What changed', { pr: 12, title: 'Billing screen with overdue invoices', branch: 'explore/billing', url: 'u', product: 'admin', productName: 'Admin demo', author: 'ann', piece: 'badge-overdue-tone', pieceTitle: 'Badge: overdue tone', nearest: 'danger', nearestToken: 'color.feedback.danger.bg' });

  it('reads "Why it exists" with names, the question and Suggest danger', () => {
    const c = productContextOf(body, { ann: 'Ann' })!;
    expect(c).toMatchObject({ who: 'Ann', title: 'Billing screen with overdue invoices', product: 'Admin demo', productHref: '?exploration=12' });
    expect(c.question).toBe('It looks a lot like "danger". Is a new one worth it, or should Ann use danger?');
    expect(c.suggest?.label).toBe('Suggest danger');
    expect(c.suggest?.comment).toMatch(/^Let's not add it to the library: danger/);
  });

  it('nothing for a branch nobody asked for', () => {
    expect(productContextOf('## What changed')).toBeNull();
    expect(productContextOf(null)).toBeNull();
  });
});

describe('nestLinked', () => {
  const row = (number: number, neededBy: number | null = null) => ({ r: { number, neededBy } });

  it('the mockup: the library branch follows its product branch, out of the Library group and its count', () => {
    const groups = [
      { key: 'admin', label: 'Admin demo', rows: [row(12)] },
      { key: 'library', label: 'Library', rows: [row(40, 12), row(41), row(42)] },
    ];
    const out = nestLinked(groups);
    expect(out.map((g) => [g.label, g.count, g.rows.map((x) => [x.r.number, x.child])])).toEqual([
      ['Admin demo', 1, [[12, false], [40, true]]],
      ['Library', 2, [[41, false], [42, false]]],
    ]);
  });

  it('keeps a library branch in place when its product branch is not listed; drops emptied groups', () => {
    expect(nestLinked([{ key: 'library', label: 'Library', rows: [row(40, 99)] }])[0]!.rows[0]!.child).toBe(false);
    const out = nestLinked([
      { key: 'admin', label: 'Admin demo', rows: [row(12)] },
      { key: 'library', label: 'Library', rows: [row(40, 12)] },
    ]);
    expect(out.map((g) => g.key)).toEqual(['admin']);
    expect(childLine('Claude AI')).toBe('Library change it needs · Claude AI');
  });
});
