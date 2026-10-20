import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'vitest';
import { childText, enclosingTag, missingPieces, nameFromClass, ruleClasses } from '../src/audit';
import { loadDesignSystem } from '../src/node/audit';
import {
  libraryBranchPlan,
  libraryPreviewState,
  linkStatus,
  mergePiecesRecord,
  nearestQuestion,
  parseNeededBy,
  parsePiecesRecord,
  pieceId,
  productBranchSentence,
  proposedTokenPath,
  suggestNearestComment,
  tokenLabel,
  whyItExists,
  withLink,
  withNeededBy,
  withPiecesRecord,
  type LibraryLink,
  type MissingPiece,
  type NeededBy,
  type PiecesRecord,
  type ProductBranchRef,
} from '../src/prod-branch';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const loaded = () => loadDesignSystem(REPO);
const live = (path: string) => {
  const { set } = loaded();
  return set.resolve(path, set.defaultCombo).css;
};

const BRANCH: ProductBranchRef = { pr: 12, title: 'Billing screen with overdue invoices', branch: 'explore/billing-overdue', url: 'https://github.com/o/r/pull/12', productKey: 'admin', productName: 'Admin demo', author: 'ann' };

const piece = (over: Partial<MissingPiece> = {}): MissingPiece => ({
  id: 'badge-overdue-tone',
  kind: 'variant',
  title: 'Badge: overdue tone',
  summary: 'Badge restyled by hand (background #fdecec).',
  name: 'overdue',
  component: 'Badge',
  aspect: 'tone',
  values: [{ category: 'color', property: 'background', value: '#fdecec' }],
  nearest: { token: 'color.feedback.danger.bg', cssVar: '--color-feedback-danger-bg', value: '#fff4f4', level: 'high', label: 'danger' },
  where: [{ file: 'apps/admin/src/x.tsx', line: 3 }],
  ...over,
});

const link = (over: Partial<LibraryLink> = {}): LibraryLink => ({ piece: 'badge-overdue-tone', kind: 'exploration', number: 40, url: 'https://github.com/o/r/pull/40', title: 'Badge: overdue tone', branch: 'explore/badge-overdue-tone', agent: 'claude', at: '2026-10-20T00:00:00Z', ...over });

describe('pieces record', () => {
  const record: PiecesRecord = { checkedAt: '2026-10-20T10:00:00Z', headSha: 'abcdef1234', pieces: [piece()], links: [], fixes: 2 };

  test('round-trips through the product branch body and replaces itself', () => {
    const body = withPiecesRecord('## Exploration: Billing\n\nPurpose.', record);
    assert.match(body, /### Missing from the library/);
    assert.match(body, /\*\*Badge: overdue tone\*\*: .* No library branch yet\./);
    assert.deepEqual(parsePiecesRecord(body), record);
    const again = withPiecesRecord(body, withLink(record, link()));
    assert.equal(again.match(/### Missing from the library/g)?.length, 1);
    assert.ok(again.startsWith('## Exploration: Billing'));
    assert.equal(parsePiecesRecord(again)!.links[0]!.number, 40);
    assert.match(again, /Library exploration: #40\./);
  });

  test('an empty check says nothing is missing; no record reads as undefined', () => {
    assert.match(withPiecesRecord('', { ...record, pieces: [] }), /Nothing: every value and component comes from the library/);
    assert.equal(parsePiecesRecord('no block'), undefined);
    assert.equal(parsePiecesRecord('<!-- bridge-pieces {broken -->'), undefined);
  });

  test('a new check keeps the links, even of pieces that are gone', () => {
    const prev = withLink(record, link());
    const next = mergePiecesRecord(prev, { checkedAt: '2026-10-21T00:00:00Z', pieces: [], fixes: 0 });
    assert.equal(next.links.length, 1);
    assert.equal(next.pieces.length, 0);
    const replaced = withLink(next, link({ number: 41 }));
    assert.deepEqual(replaced.links.map((l) => l.number), [41]);
  });
});

describe('needed by', () => {
  const n: NeededBy = { pr: 12, title: BRANCH.title, branch: BRANCH.branch, url: BRANCH.url, product: 'admin', productName: 'Admin demo', author: 'ann', piece: 'badge-overdue-tone', pieceTitle: 'Badge: overdue tone', nearest: 'danger', nearestToken: 'color.feedback.danger.bg' };

  test('goes first in the library body, once, and reads back', () => {
    const body = withNeededBy('## What changed\n\nText.', n);
    assert.ok(body.startsWith('**Needed by:** [Billing screen with overdue invoices](https://github.com/o/r/pull/12) (#12) in Admin demo for @ann.'));
    assert.match(body, /closest the library has today is danger \(`color.feedback.danger.bg`\)/);
    assert.deepEqual(parseNeededBy(body), n);
    const twice = withNeededBy(body, { ...n, title: 'Renamed' });
    assert.equal(twice.match(/\*\*Needed by:\*\*/g)?.length, 1);
    assert.equal(parseNeededBy(twice)!.title, 'Renamed');
    assert.ok(twice.endsWith('Text.'));
  });

  test('why it exists, the reviewer question and the suggestion use names when known', () => {
    assert.deepEqual(whyItExists(n, { names: { ann: 'Ann' } }), { who: 'Ann', title: BRANCH.title, product: 'Admin demo' });
    assert.equal(whyItExists({ ...n, author: undefined }).who, 'A product team');
    assert.equal(nearestQuestion(n, { names: { ann: 'Ann' } }), 'It looks a lot like "danger". Is a new one worth it, or should Ann use danger?');
    assert.equal(nearestQuestion({ ...n, nearest: undefined }), null);
    assert.match(suggestNearestComment(n)!, /^Let's not add it to the library: danger \(`color.feedback.danger.bg`\) covers it\. Use it on Billing screen with overdue invoices \(#12\) instead/);
    assert.ok(!/\u2014/.test(suggestNearestComment(n)!));
  });
});

describe('libraryBranchPlan', () => {
  test('a variant opens a library exploration with a brief, honestly not a token change', () => {
    const p = libraryBranchPlan(piece(), BRANCH);
    assert.equal(p.kind, 'exploration');
    if (p.kind !== 'exploration') return;
    assert.equal(p.exploration.name, 'Badge: overdue tone');
    assert.match(p.exploration.purpose, /^Admin demo needs it for "Billing screen with overdue invoices" \(#12\): an overdue tone on Badge \(background #fdecec\)/);
    assert.match(p.brief, /Add the overdue tone to Badge in the library/);
    assert.match(p.brief, /why danger is not enough/);
    assert.equal(p.neededBy.piece, 'badge-overdue-tone');
    assert.equal(p.neededBy.nearest, 'danger');
  });

  test('a token piece adds the token in every file of the closest token', () => {
    const p = libraryBranchPlan(
      piece({ id: 'color-c2410c', kind: 'token', title: 'New color #C2410C', component: undefined, name: 'accent', token: { path: 'color.feedback.accent.bg', type: 'color', value: '#c2410c', files: ['semantic/light.tokens.json', 'semantic/dark.tokens.json'] } }),
      BRANCH,
    );
    assert.equal(p.kind, 'token-change');
    if (p.kind !== 'token-change') return;
    assert.equal(p.title, 'Add color.feedback.accent.bg');
    assert.deepEqual(p.edits.map((e) => e.file), ['semantic/light.tokens.json', 'semantic/dark.tokens.json']);
    assert.ok(p.edits.every((e) => e.op === 'add' && e.value === '#c2410c' && /Same value in every theme/.test(e.description ?? '')));
  });

  test('a new component is a request, labelled as one', () => {
    const p = libraryBranchPlan(piece({ id: 'component-datepicker', kind: 'component', title: 'New component: DatePicker', component: 'DatePicker', name: 'DatePicker', values: [], nearest: undefined }), BRANCH, { requestedBy: 'ann' });
    assert.equal(p.kind, 'request');
    if (p.kind !== 'request') return;
    assert.equal(p.request.kind, 'new-component');
    assert.equal(p.request.component, 'DatePicker');
    assert.equal(p.request.requestedBy, 'ann');
    assert.equal(p.title, 'New component: DatePicker');
  });
});

describe('linkStatus', () => {
  test('a pull request in review names who reviews', () => {
    assert.deepEqual(linkStatus({ kind: 'token-change', state: 'open', draft: false, requestedReviewers: ['dana'] }), { key: 'in-review', label: 'In review', people: ['dana'], line: 'In review · @dana reviews' });
    assert.equal(linkStatus({ kind: 'token-change', state: 'open', draft: false, requestedReviewers: ['dana', 'lee'] }).line, 'In review · @dana and @lee review');
  });

  test('drafts, explorations, requested changes, approvals, shipped and closed', () => {
    assert.equal(linkStatus({ kind: 'token-change', state: 'open', draft: true }).key, 'draft');
    assert.equal(linkStatus({ kind: 'exploration', state: 'open', draft: true, labels: ['exploration'] }).label, 'Being built');
    assert.equal(linkStatus({ kind: 'token-change', state: 'open', draft: false, reviews: [{ user: 'dana', state: 'APPROVED' }, { user: 'dana', state: 'CHANGES_REQUESTED' }] }).line, 'Changes requested · @dana asks');
    assert.equal(linkStatus({ kind: 'token-change', state: 'open', draft: false, reviews: [{ user: 'dana', state: 'APPROVED' }] }).key, 'approved');
    assert.equal(linkStatus({ kind: 'token-change', state: 'merged', draft: false }).label, 'Shipped');
    assert.equal(linkStatus({ kind: 'exploration', state: 'closed', draft: false }).key, 'closed');
  });

  test('requests: requested, in progress, done, declined', () => {
    assert.equal(linkStatus({ kind: 'request', state: 'open' }).label, 'Requested');
    assert.equal(linkStatus({ kind: 'request', state: 'open', implemented: true, assignees: ['lee'] }).line, 'In progress · @lee builds');
    assert.equal(linkStatus({ kind: 'request', state: 'closed', stateReason: 'completed' }).key, 'done');
    assert.equal(linkStatus({ kind: 'request', state: 'closed', stateReason: 'not_planned' }).key, 'declined');
  });
});

describe('libraryPreviewState', () => {
  const base = { kind: 'token-change' as const, lifecycle: 'open' as const, hasChanges: true, missing: 0, total: 2, behindMain: null };

  test('open library branch: used, outdated, not used, nothing yet', () => {
    assert.equal(libraryPreviewState(base).key, 'preview');
    assert.equal(libraryPreviewState(base).action, null);
    assert.deepEqual(libraryPreviewState({ ...base, missing: 1 }).action, { kind: 'refresh-preview', label: 'Get the latest preview' });
    assert.deepEqual(libraryPreviewState({ ...base, missing: 2 }).action, { kind: 'use-preview', label: 'Use its preview in my branch' });
    assert.equal(libraryPreviewState({ ...base, missing: null, total: null }).key, 'not-used');
    assert.equal(libraryPreviewState({ ...base, kind: 'exploration', hasChanges: false }).key, 'nothing-yet');
  });

  test('shipped: switch until the product branch has main', () => {
    assert.deepEqual(libraryPreviewState({ ...base, lifecycle: 'merged', behindMain: 3 }).action, { kind: 'switch', label: 'Switch to the published version' });
    assert.equal(libraryPreviewState({ ...base, lifecycle: 'merged', behindMain: 0 }).key, 'switched');
    assert.equal(libraryPreviewState({ ...base, lifecycle: 'merged', behindMain: null }).key, 'published');
  });

  test('closed and requests', () => {
    assert.match(libraryPreviewState({ ...base, lifecycle: 'closed', nearest: 'danger' }).sentence, /Ask Claude to use danger instead/);
    assert.equal(libraryPreviewState({ ...base, kind: 'request' }).key, 'nothing-yet');
    assert.equal(libraryPreviewState({ ...base, kind: 'request', lifecycle: 'closed' }).key, 'declined');
    assert.equal(libraryPreviewState({ ...base, kind: 'request', lifecycle: 'merged', behindMain: 1 }).action?.kind, 'switch');
  });

  test('no em dash in any sentence', () => {
    const all = [libraryPreviewState(base), libraryPreviewState({ ...base, missing: 1 }), libraryPreviewState({ ...base, lifecycle: 'merged', behindMain: 2 }), libraryPreviewState({ ...base, kind: 'request' })];
    assert.ok(all.every((s) => !s.sentence.includes('\u2014')));
  });
});

describe('productBranchSentence', () => {
  const r: PiecesRecord = { checkedAt: '2026-10-20T00:00:00Z', pieces: [piece()], links: [link()] };

  test('the mockup sentence when Claude opened the one library branch', () => {
    const s = productBranchSentence(r);
    assert.equal(`${s.lead}${s.strong}${s.rest}`, 'Built with the library. 1 piece was missing, and Claude AI opened a library branch for it.');
    assert.equal(s.strong, '1 piece was missing');
  });

  test('you, a teammate, none linked, some linked, nothing missing, never checked', () => {
    const mine = { ...r, links: [link({ agent: undefined, openedBy: 'ann' })] };
    assert.match(Object.values(productBranchSentence(mine, { viewer: 'ann' })).join(''), /and you opened a library branch for it\.$/);
    assert.match(Object.values(productBranchSentence(mine, { viewer: 'dana' })).join(''), /and @ann opened/);
    const two = { ...r, pieces: [piece(), piece({ id: 'b' })] };
    assert.equal(Object.values(productBranchSentence({ ...two, links: [] })).join(''), 'Built with the library. 2 pieces are missing: open a library branch for each.');
    assert.equal(Object.values(productBranchSentence(two)).join(''), 'Built with the library. 2 pieces were missing: 1 has a library branch, 1 still needs one.');
    assert.equal(Object.values(productBranchSentence({ ...r, pieces: [], links: [] })).join(''), 'Built with the library. Nothing is missing: every value and component comes from it.');
    assert.equal(productBranchSentence(undefined).lead, 'Not checked against the library yet.');
  });
});

describe('naming', () => {
  test('piece ids, token labels and proposed token paths', () => {
    assert.equal(pieceId(['Badge', 'overdue', 'tone']), 'badge-overdue-tone');
    assert.equal(tokenLabel('color.feedback.danger.bg'), 'danger');
    assert.equal(tokenLabel('radius.control'), 'control');
    assert.equal(proposedTokenPath('color.feedback.danger.bg', 'Overdue', 'color'), 'color.feedback.overdue.bg');
    assert.equal(proposedTokenPath('radius.control', 'card', 'radius'), 'radius.card');
    assert.equal(proposedTokenPath(undefined, 'accent', 'color'), 'color.accent');
  });

  test('class names and markup helpers', () => {
    assert.equal(nameFromClass('badgeOverdue', 'Badge'), 'overdue');
    assert.equal(nameFromClass('invoice-status--late'), 'late');
    assert.deepEqual(ruleClasses('.a { color: red }\n.badge.overdue {\n  color: #c00;\n}', 40), ['badge', 'overdue']);
    const tsx = 'return <Badge tone="danger" style={{ background: "#fdecec" }}>Overdue</Badge>;';
    const tag = enclosingTag(tsx, tsx.indexOf('#fdecec'));
    assert.equal(tag?.name, 'Badge');
    assert.equal(childText(tsx, tag!.start), 'Overdue');
    assert.equal(enclosingTag('<div>{x.map((y) => <b key={y} />)} "#fff"</div>', 40), null);
  });
});

describe('missingPieces', () => {
  const ds = () => loaded().index;
  const danger = () => live('color.feedback.danger.bg')!;

  test('a Badge restyled by hand in a CSS module is one variant, named from its class', () => {
    const r = missingPieces({
      ds: ds(),
      set: loaded().set,
      files: [
        {
          path: 'apps/admin/src/billing/Billing.tsx',
          before: null,
          after: "import { Badge } from '@bridge-ds/react';\nimport styles from './billing.module.css';\nexport function Row() {\n  return <Badge className={styles.overdue}>Overdue</Badge>;\n}\n",
        },
        { path: 'apps/admin/src/billing/billing.module.css', before: null, after: '.overdue {\n  background: #fdecec;\n  color: #a3123a;\n}\n' },
      ],
    });
    assert.equal(r.pieces.length, 1);
    const p = r.pieces[0]!;
    assert.equal(p.kind, 'variant');
    assert.equal(p.title, 'Badge: overdue tone');
    assert.equal(p.id, 'badge-overdue-tone');
    assert.deepEqual(p.values.map((v) => v.value), ['#fdecec', '#a3123a']);
    assert.ok(p.nearest, 'the closest library colour is attached');
    assert.equal(r.files, 2);
  });

  test('an inline style on a library component is a variant named from its text; values the branch did not add are left out', () => {
    const before = "import { Badge } from '@bridge-ds/react';\nconst old = { color: '#123456' };\n";
    const after = `${before}export const B = () => <Badge style={{ background: '#fdecec' }}>Late</Badge>;\n`;
    const r = missingPieces({ ds: ds(), files: [{ path: 'apps/admin/src/a.tsx', before, after }] });
    assert.deepEqual(r.pieces.map((p) => p.title), ['Badge: late tone']);
  });

  test('a value equal to a token is a fix; a new colour elsewhere is a token piece beside the closest token', () => {
    const r = missingPieces({
      ds: ds(),
      set: loaded().set,
      files: [{ path: 'apps/admin/src/x.module.css', before: '', after: `.accent {\n  color: #c2410c;\n}\n.ok {\n  background: ${danger()};\n}\n` }],
    });
    assert.equal(r.fixes.length, 1);
    assert.equal(r.fixes[0]!.use.length > 0, true);
    const t = r.pieces.find((p) => p.kind === 'token')!;
    assert.equal(t.title, 'New color #C2410C');
    assert.equal(t.name, 'accent');
    assert.ok(t.token!.path.endsWith('accent') || t.token!.path.includes('.accent.'), t.token!.path);
    assert.ok(t.token!.files.length >= 1);
  });

  test('a component from another UI library with no library equivalent is a new component', () => {
    const r = missingPieces({
      ds: ds(),
      files: [{ path: 'apps/admin/src/c.tsx', before: null, after: "import { Rating } from '@mui/material';\nexport const C = () => <Rating value={3} />;\n" }],
    });
    const c = r.pieces.find((p) => p.kind === 'component');
    assert.equal(c?.title, 'New component: Rating');
    assert.match(c!.summary, /comes from @mui\/material/);
  });

  test('removed files and files outside the audit are not read', () => {
    const r = missingPieces({ ds: ds(), files: [{ path: 'a.css', before: '.a{color:#c2410c}', after: null }, { path: 'README.md', before: null, after: '#c2410c' }] });
    assert.deepEqual(r, { pieces: [], fixes: [], files: 0 });
  });
});
