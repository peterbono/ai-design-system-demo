import type { ProductConfig } from '@bridge-ds/core';
import { describe, expect, it } from 'vitest';
import {
  changeGroups,
  checksLine,
  commentRole,
  conversation,
  draftedKeys,
  isClaudeDraft,
  currentChange,
  guidanceMeta,
  guidanceView,
  lookedProgress,
  namesIn,
  readLooked,
  reviewActions,
  reviewCrumbs,
  productWorkOf,
  productWorkLine,
  productWorkEmpty,
  bodyWhy,
  shotComponent,
  splitChanges,
  tokenGroup,
  valueName,
  whoLine,
  withGuidanceEdit,
  wordDiff,
  writeLooked,
  type ActionInput,
} from './review-page';
import { jargonIn } from './vocabulary';

const added = (segs: { text: string; added: boolean }[]) => segs.filter((s) => s.added).map((s) => s.text);
const joined = (segs: { text: string }[]) => segs.map((s) => s.text).join('');

describe('wordDiff', () => {
  it('marks everything new when there was nothing', () => {
    expect(wordDiff(null, 'Hide text.')).toEqual([{ text: 'Hide text.', added: true }]);
    expect(wordDiff('  ', 'Hide text.')).toEqual([{ text: 'Hide text.', added: true }]);
  });
  it('marks nothing when the text is the same', () => {
    expect(wordDiff('Same text.', 'Same text.')).toEqual([{ text: 'Same text.', added: false }]);
  });
  it('marks only the inserted words and keeps the text whole', () => {
    const segs = wordDiff('Use it for icon buttons.', 'Use it for icon buttons and icon links.');
    expect(joined(segs)).toBe('Use it for icon buttons and icon links.');
    expect(added(segs)).toEqual(['buttons and icon links.']);
  });
  it('never ends a highlight on a space', () => {
    const segs = wordDiff('a c', 'a b c');
    expect(added(segs)).toEqual(['b']);
    expect(joined(segs)).toBe('a b c');
  });
  it('returns nothing for empty text', () => {
    expect(wordDiff('x', '')).toEqual([]);
  });
});

describe('guidanceView', () => {
  const base = { summary: 'Hides text.', whenToUse: ['Icon-only buttons.'], whenNotToUse: ['Hiding from everyone.'], dos: [{ title: 'Full phrase', text: 'Delete invoice.' }], donts: [], accessibility: ['Read by screen readers.'] };
  it('shows the sections as the Library does, new text highlighted, the summary only when it changes', () => {
    const head = { ...base, whenToUse: ['Icon-only buttons and links.', 'Extra context after a link.'] };
    const v = guidanceView(base, head);
    expect(v.map((s) => s.label)).toEqual(['When to use', 'When not to use', 'Do', 'Accessibility']);
    const use = v[0]!;
    expect(use.changed).toBe(true);
    expect(added(use.items[0]!.text)).toEqual(['buttons and links.']);
    expect(use.items[1]!.text).toEqual([{ text: 'Extra context after a link.', added: true }]);
    expect(v[1]!.changed).toBe(false);
  });
  it('highlights all of a new file, summary included', () => {
    const v = guidanceView(null, { summary: 'New.', whenToUse: ['A.'], dos: [{ title: 'T', text: 'X' }] });
    expect(v[0]!.label).toBe('Summary');
    expect(v.every((s) => s.changed)).toBe(true);
    expect(v.find((s) => s.key === 'dos')!.items[0]!.title).toEqual([{ text: 'T', added: true }]);
  });
  it('keeps an item moved elsewhere unhighlighted and lists removed ones', () => {
    const v = guidanceView({ whenToUse: ['A.', 'B.', 'C.'] }, { whenToUse: ['B.', 'A.'] });
    expect(v[0]!.items.every((i) => !i.changed)).toBe(true);
    expect(v[0]!.removed).toEqual(['C.']);
    expect(v[0]!.changed).toBe(true);
  });
  it('reads a Claude draft nobody accepted as new text, even when main holds it', () => {
    const draft = { ...base, draftedBy: 'claude', needsReview: true, draftedSections: ['whenToUse'] };
    const v = guidanceView(draft, draft);
    expect(v.find((s) => s.key === 'whenToUse')!.items[0]!.text).toEqual([{ text: 'Icon-only buttons.', added: true }]);
    expect(v.find((s) => s.key === 'accessibility')!.changed).toBe(false);
    expect(draftedKeys({ needsReview: true })).toHaveLength(7);
    expect(draftedKeys({ needsReview: false, draftedSections: ['dos'] })).toEqual([]);
    expect(isClaudeDraft(draft)).toBe(true);
    expect(isClaudeDraft({ ...draft, needsReview: false })).toBe(false);
    expect(isClaudeDraft(null)).toBe(false);
  });
  it('says how many sections have new text', () => {
    expect(guidanceMeta(guidanceView(null, { whenToUse: ['A.'], accessibility: ['B.'] }))).toBe('2 sections with new text');
    expect(guidanceMeta(guidanceView({ whenToUse: ['A.'] }, { whenToUse: ['A.'] }))).toBe('no new text');
  });
  it('edits one item and keeps the rest', () => {
    const d = { summary: 'S', whenToUse: ['A', 'B'], dos: [{ title: 'T', text: 'X', example: 1 }] };
    expect(withGuidanceEdit(d, 'whenToUse', 1, 'C').whenToUse).toEqual(['A', 'C']);
    expect(withGuidanceEdit(d, 'dos', 0, { title: 'T2', text: 'Y' }).dos).toEqual([{ title: 'T2', text: 'Y', example: 1 }]);
    expect(withGuidanceEdit(d, 'summary', 0, 'S2').summary).toBe('S2');
    expect(d.whenToUse).toEqual(['A', 'B']);
  });
});

describe('splitChanges', () => {
  const files = [
    { filename: 'packages/tokens/src/semantic/light.tokens.json' },
    { filename: 'packages/react/src/components/Badge/Badge.tsx' },
    { filename: 'packages/react/src/components/Badge/Badge.module.css' },
    { filename: 'packages/react/src/components/Badge/Badge.test.tsx' },
    { filename: 'packages/react/src/components/Badge/Badge.docs.json' },
    { filename: 'packages/react/src/components/Avatar/Avatar.tsx', status: 'added' },
    { filename: 'apps/docs-site/src/scripts/reviews.ts' },
    { filename: '.changeset/x.md' },
  ];
  it('splits by token group, component and guidance file, code left to developers', () => {
    const c = splitChanges({
      files,
      tokens: [
        { path: 'color.bg.default', kind: 'changed' },
        { path: 'color.bg.default', kind: 'changed' },
        { path: 'color.bg.overdue', kind: 'added' },
        { path: 'space.table.row', kind: 'changed' },
      ],
    });
    expect(c.map((x) => x.id)).toEqual(['tokens:color.bg', 'tokens:space.table', 'component:Avatar', 'component:Badge', 'guidance:Badge']);
    expect(c[0]!.meta).toBe('1 new, 1 changed');
    expect(c[2]!.meta).toBe('new component');
    expect(c[3]!.paths).toEqual(['packages/react/src/components/Badge/Badge.tsx', 'packages/react/src/components/Badge/Badge.module.css']);
    expect(c[4]!.title).toBe('Badge guidance');
  });
  it('keeps token files as one change while the token review is not read', () => {
    const c = splitChanges({ files: [{ filename: 'a.tokens.json' }, { filename: 'b.tokens.json' }], tokens: null });
    expect(c).toEqual([expect.objectContaining({ id: 'tokens:all', meta: '2 token files' })]);
  });
  it('is one change for a guidance-only branch, with its meta once read', () => {
    const c = splitChanges({ files: [{ filename: 'packages/react/src/components/VisuallyHidden/VisuallyHidden.docs.json' }], guidanceMeta: { 'packages/react/src/components/VisuallyHidden/VisuallyHidden.docs.json': '2 sections with new text' } });
    expect(c).toHaveLength(1);
    expect(c[0]!.meta).toBe('2 sections with new text');
  });
  it('groups changes in outline order', () => {
    const c = splitChanges({ files, tokens: null });
    expect(changeGroups(c).map((g) => g.label)).toEqual(['Tokens', 'Components', 'Guidance']);
  });
  it('names a token value in words', () => {
    expect(valueName({ alias: 'palette.neutral.50', css: '#f5f7f9' })).toBe('Neutral 50');
    expect(valueName({ alias: 'color.agent.surface', css: '#fef6ea' })).toBe('Agent surface');
    expect(valueName({ alias: 'space.table-row', css: '8px' })).toBe('Space table row');
    expect(valueName({ alias: null, css: '12px' })).toBe('12px');
  });
  it('groups a token under its parent', () => {
    expect(tokenGroup('color.bg.default')).toBe('color.bg');
    expect(tokenGroup('avatar.agent-bg')).toBe('avatar');
    expect(tokenGroup('radius')).toBe('radius');
  });
  it('finds the component a story shows, the longest name first', () => {
    expect(shotComponent('components-buttongroup--default', ['Button', 'ButtonGroup'])).toBe('ButtonGroup');
    expect(shotComponent('route:/orders', ['Badge'])).toBeNull();
  });
});

describe('looked at', () => {
  const changes = splitChanges({ files: [{ filename: 'a.tokens.json' }, { filename: 'packages/react/src/components/A/A.tsx' }, { filename: 'packages/react/src/components/A/A.docs.json' }], tokens: null });
  it('stores per branch and survives bad storage', () => {
    const raw = writeLooked(null, 7, new Set(['tokens:all']));
    expect([...readLooked(raw, 7)]).toEqual(['tokens:all']);
    expect(readLooked(raw, 8).size).toBe(0);
    expect(readLooked('not json', 7).size).toBe(0);
    expect(readLooked('[1]', 7).size).toBe(0);
    expect(JSON.parse(writeLooked(raw, 7, new Set()))).toEqual({});
  });
  it('counts progress and what is left', () => {
    const p = lookedProgress(changes, new Set(['tokens:all']));
    expect(p.line).toBe('1 of 3 looked at');
    expect(p.leftLine).toBe('2 changes left to look at');
    expect(lookedProgress(changes, new Set(changes.map((c) => c.id))).leftLine).toBeNull();
  });
  it('opens the picked change, else the first not looked at', () => {
    expect(currentChange(changes, new Set(['tokens:all']), null)).toBe('component:A');
    expect(currentChange(changes, new Set(), 'guidance:A')).toBe('guidance:A');
    expect(currentChange(changes, new Set(), 'gone')).toBe('tokens:all');
    expect(currentChange([], new Set(), null)).toBeNull();
  });
});

describe('conversation', () => {
  const ctx = { author: 'ann', reviewers: ['@dana'] };
  it('hides bots, gives roles, shows the latest and keeps the rest behind', () => {
    const c = conversation(
      [
        { login: 'vercel[bot]', at: '2026-10-01', body: '<table>preview</table>', kind: 'COMMENT' },
        { login: 'ann', at: '2026-10-02', body: 'Ready.', kind: 'COMMENT' },
        { login: 'Dana', at: '2026-10-04', body: 'Icon links too?', kind: 'COMMENT' },
        { login: 'lee', at: '2026-10-03', body: '', kind: 'APPROVED' },
        { login: 'max', at: '2026-10-03', body: '', kind: 'COMMENTED' },
      ],
      ctx,
    );
    expect(c.count).toBe(3);
    expect(c.latest).toMatchObject({ login: 'Dana', role: 'reviewer', text: 'Icon links too?' });
    expect(c.earlier.map((e) => [e.login, e.role, e.text])).toEqual([
      ['ann', 'author', 'Ready.'],
      ['lee', 'reviewer', 'Approved.'],
    ]);
  });
  it('is empty without people', () => {
    expect(conversation([{ login: 'github-actions[bot]', at: 'x', body: 'y', kind: 'COMMENT' }], ctx)).toMatchObject({ count: 0, latest: null });
  });
  it('gives no role to someone who only comments', () => {
    expect(commentRole('zoe', ctx)).toBeNull();
    expect(commentRole(null, ctx)).toBeNull();
  });
});

describe('checksLine', () => {
  it('says all pass, with the contrast count when tokens were checked', () => {
    expect(checksLine({ design: { state: 'pass', text: '304 contrast checks still pass.' }, developer: { state: 'pass', text: 'All pass.' }, designFails: false, developerFailing: 0, oldValue: false }).text).toBe('All 304 contrast checks pass');
    expect(checksLine({ design: null, developer: { state: 'pass', text: 'All pass.' }, designFails: false, developerFailing: 0, oldValue: false })).toMatchObject({ state: 'pass', text: 'All checks pass' });
  });
  it('says what fails in plain words', () => {
    const l = checksLine({ design: null, developer: { state: 'fail', text: '2 developer tests fail. A developer fixes them.' }, designFails: false, developerFailing: 2, oldValue: false });
    expect(l).toMatchObject({ state: 'fail', text: '2 developer tests fail. A developer fixes them.' });
    expect(l.rows).toHaveLength(1);
  });
  it('tells a designer who acts on failing developer tests, never which tests', () => {
    const story = { design: { state: 'pass' as const, text: '304 contrast checks still pass.' }, developer: { state: 'fail' as const, text: '2 developer tests fail. A developer fixes them.' }, designFails: false, developerFailing: 2, oldValue: false };
    const l = checksLine(story, { forDesigner: true });
    expect(l).toMatchObject({ state: 'fail', text: 'Code checks fail: a developer is on it.' });
    expect(l.rows[1]).toEqual({ label: 'Code checks', state: 'fail', text: 'A developer is on it.' });
    expect(JSON.stringify(l)).not.toMatch(/developer tests?/);
  });
  it('says when checks run or none ran', () => {
    expect(checksLine({ design: null, developer: { state: 'pending', text: '3 checks still running.' }, designFails: false, developerFailing: 0, oldValue: false }).state).toBe('pending');
    expect(checksLine({ design: null, developer: null, designFails: false, developerFailing: 0, oldValue: false }).state).toBe('none');
  });
});

describe('who line and names', () => {
  it('turns logins into names, never an org team', () => {
    expect(namesIn('Waiting for @ann and @org/design.', (l) => (l === 'ann' ? 'Ann Lee' : l))).toBe('Waiting for Ann Lee and @org/design.');
  });
  it('says Claude drafted guidance, or who asks for a review, else the status', () => {
    const base = { author: 'Ann', agent: false, guidanceOnly: false, canEdit: false, asked: false, lifecycle: 'ready' as const, sentence: 'Waiting for Dana.' };
    expect(whoLine({ ...base, agent: true, guidanceOnly: true, canEdit: true })).toEqual({ lead: 'Claude AI', rest: 'drafted it from the code. New text is highlighted; click any part to edit it.' });
    expect(whoLine({ ...base, agent: true, guidanceOnly: true }).rest).toBe('drafted it from the code. New text is highlighted.');
    expect(whoLine({ ...base, asked: true })).toEqual({ lead: 'Ann', rest: 'asks for your review' });
    expect(whoLine({ ...base, lifecycle: 'shipped', asked: true })).toEqual({ lead: null, rest: 'Waiting for Dana.' });
  });
});

describe('reviewActions', () => {
  const base: ActionInput = {
    lifecycle: 'ready',
    connected: true,
    canWrite: true,
    isAuthor: false,
    canApprove: true,
    canMerge: false,
    mergeAfterApprove: false,
    overrideOnly: false,
    visual: false,
    shareable: true,
    exploration: false,
    statusAction: null,
  };
  it('approves, or approves and merges when the viewer can merge after', () => {
    expect(reviewActions(base).primary).toEqual({ kind: 'approve', label: 'Approve' });
    expect(reviewActions({ ...base, mergeAfterApprove: true }).primary).toEqual({ kind: 'approve-merge', label: 'Approve and merge' });
    expect(reviewActions({ ...base, mergeAfterApprove: true, canWrite: false }).primary?.kind).toBe('approve');
  });
  it('merges once approved, never lets the author approve', () => {
    expect(reviewActions({ ...base, canApprove: false, canMerge: true }).primary?.kind).toBe('merge');
    const a = reviewActions({ ...base, isAuthor: true });
    expect(a.primary).toBeNull();
    expect(a.suggest).toBe(false);
    expect(a.menu.draft).toBe(true);
  });
  it('offers the override only when it is the only way, with one sentence', () => {
    expect(reviewActions(base).menu.override).toBeNull();
    expect(reviewActions({ ...base, overrideOnly: true }).menu.override).toMatch(/owner/);
    expect(reviewActions({ ...base, overrideOnly: true, canMerge: true }).menu.override).toBeNull();
  });
  it('shares only with a visual change', () => {
    expect(reviewActions(base).menu.share).toBe(false);
    expect(reviewActions({ ...base, visual: true }).menu.share).toBe(true);
    expect(reviewActions({ ...base, visual: true, shareable: false }).menu.share).toBe(false);
  });
  it('asks the author of a draft to request review', () => {
    const a = reviewActions({ ...base, lifecycle: 'draft', isAuthor: true });
    expect(a.primary).toEqual({ kind: 'request-review', label: 'Request review' });
    expect(a.suggest).toBe(false);
    expect(reviewActions({ ...base, lifecycle: 'draft' }).primary).toBeNull();
  });
  it('reopens or starts again a closed change, nothing to close', () => {
    const c = reviewActions({ ...base, lifecycle: 'closed', statusAction: 'reopen' });
    expect(c.primary?.label).toBe('Reopen');
    expect(c.comment).toBe(false);
    expect(c.menu.close).toBe(false);
    expect(reviewActions({ ...base, lifecycle: 'shipped' }).primary).toBeNull();
  });
  it('asks to connect without an account', () => {
    const a = reviewActions({ ...base, connected: false });
    expect(a.primary?.kind).toBe('connect');
    expect(a.comment).toBe(false);
    expect(a.menu).toEqual({ override: null, share: false, draft: false, close: false });
  });
  it('speaks designer words', () => {
    for (const l of ['Approve', 'Approve and merge', 'Request review', 'Reopen', 'Start again from this']) expect(jargonIn(l)).toEqual([]);
    expect(jargonIn(reviewActions({ ...base, overrideOnly: true }).menu.override!)).toEqual([]);
  });
});

describe('reviewCrumbs', () => {
  it('files the branch under its product, the title last and not a link', () => {
    expect(reviewCrumbs(['apps/admin/src/x.tsx'], 'T').map((c) => c.label)).toEqual(['Branches', 'Admin demo', 'T']);
    const c = reviewCrumbs(null, 'T');
    expect(c[1]!.label).toBe('Library');
    expect(c[2]!.href).toBeUndefined();
  });

  const account = [
    { key: 'library', name: 'Library', path: 'packages', framework: 'react', default: true },
    { key: 'account', name: 'Account app', path: 'apps/account', framework: 'react' },
  ] as ProductConfig[];

  it("reads the site's products and the product label, never Library for a product screen", () => {
    expect(reviewCrumbs(['apps/account/src/pages/Billing.tsx'], 'T', { products: account }).map((c) => c.label)).toEqual(['Branches', 'Account app', 'T']);
    expect(reviewCrumbs(null, 'T', { products: account, labels: [{ name: 'product: account' }] })[1]!.label).toBe('Account app');
  });

  it('files a running exploration under Explorations', () => {
    expect(reviewCrumbs(['apps/account/src/pages/Profile.tsx'], 'Profile page', { products: account, exploration: true }).map((c) => c.label)).toEqual(['Branches', 'Explorations', 'Profile page']);
  });
});

describe('productWorkOf', () => {
  const products = [
    { key: 'library', name: 'Library', path: 'packages', framework: 'react', default: true },
    { key: 'account', name: 'Account app', path: 'apps/account', framework: 'react' },
  ] as ProductConfig[];

  it('is null for a library branch', () => {
    expect(productWorkOf({ exploration: false, files: ['packages/react/src/Button.tsx'], products })).toBeNull();
  });

  it('names the product of a product branch, keeps only the previews with a link', () => {
    const v = productWorkOf({ exploration: false, files: ['apps/account/src/pages/Billing.tsx'], products, previews: [{ label: 'Admin demo', url: 'https://a.example', state: 'ready' }, { label: 'Component sandbox', url: null, state: 'unknown' }], tryUrl: 'https://a.example/?bridge=45' });
    expect(v).toEqual({ kind: 'product', product: 'Account app', purpose: null, useCase: null, experimental: [], previews: [{ label: 'Admin demo', url: 'https://a.example' }], tryUrl: 'https://a.example/?bridge=45', previewState: 'missing' });
    expect(productWorkLine(v!)).toBe('A change to Account app, built with the library.');
  });

  it('says what an exploration is for, in designer words', () => {
    const v = productWorkOf({ exploration: true, files: null, labels: ['product: account'], products, purpose: 'Try the new profile page with customers' });
    expect(v!.kind).toBe('exploration');
    const line = productWorkLine(v!);
    expect(line).toBe('An exploration in Account app, never merged as is. Try the new profile page with customers.');
    expect(productWorkEmpty(v!)).toMatch(/^No preview of it yet\./);
    for (const t of [line, productWorkEmpty(v!)]) expect(t).not.toMatch(/\u2014|pull request|\bPR\b|\bmain\b/);
  });

  it('says why there is no preview: none set up, did not build, still building', () => {
    const none = productWorkOf({ exploration: true, files: null, products })!;
    expect(none.previewState).toBe('none');
    const failed = productWorkOf({ exploration: true, files: null, products, previews: [{ label: 'Admin demo', url: 'https://x.example', state: 'failed' }] })!;
    expect(failed).toMatchObject({ previews: [], previewState: 'failed' });
    expect(productWorkEmpty(failed)).toMatch(/did not build/);
    expect(productWorkEmpty({ product: 'the library', previewState: 'building' })).toMatch(/being built/);
    expect(productWorkEmpty({ product: 'the library', previewState: 'missing' })).toMatch(/^No preview of this version yet\./);
    expect(productWorkOf({ exploration: true, files: null, products, useCase: 'Other' })!.useCase).toBeNull();
  });

  it('calls a library exploration the library', () => {
    expect(productWorkOf({ exploration: true, files: ['packages/react/src/Button.tsx'], products })!.product).toBe('the library');
  });
});

describe('bodyWhy', () => {
  it('reads the first paragraph under What changed and why, as plain text', () => {
    const body = '## What changed and why\n\nAccount app, Billing page. The status is now the library `Badge` **instead** of [text](https://x).\n\nNo library change.\n\n## Risk tier';
    expect(bodyWhy(body)).toBe('Account app, Billing page. The status is now the library Badge instead of text.');
  });

  it('is null without that section, and cuts long text on a word', () => {
    expect(bodyWhy('Fixes #3')).toBeNull();
    expect(bodyWhy(null)).toBeNull();
    const long = bodyWhy(`## Why\n\n${'word '.repeat(100)}`)!;
    expect(long.length).toBeLessThanOrEqual(283);
    expect(long.endsWith('word...')).toBe(true);
  });
});
