import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'vitest';
import { fsSource } from '../src/node/fs-source';
import { loadRepoModel } from '../src/repo-model';
import { memorySource } from '../src/repo-source';
import {
  auditId,
  buildSnapshot,
  parseSnapshot,
  recordingSource,
  snapshotAudit,
  snapshotIsFresh,
  snapshotSource,
  SnapshotError,
  SNAPSHOT_SCHEMA_VERSION,
  type RepoSnapshot,
} from '../src/snapshot';
import type { AuditReport } from '../src/audit/types';

const json = (x: unknown) => JSON.stringify(x);

const color = (hex: string) => ({ $type: 'color', $value: { colorSpace: 'srgb', components: [0, 0, 0].map((_, i) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255), hex } });
const dim = (value: number) => ({ $type: 'dimension', $value: { value, unit: 'px' } });

const TEAM: Record<string, string> = {
  'bridge.config.json': json({
    repo: { owner: 'acme', name: 'design', defaultBranch: 'trunk' },
    tokens: { root: 'design/tokens', usage: 'notes.json' },
    modes: {
      brand: { values: ['acme', 'night-owl'], default: 'acme' },
      theme: { values: ['light', 'dark'], default: 'light', parity: true },
      density: { values: ['comfortable', 'compact'], default: 'comfortable' },
    },
    contrast: { path: 'design/tokens/pairs.json' },
    components: { dir: 'src/ui', index: 'src/main.ts', specs: 'src/specs.json' },
    governance: { owners: { design: ['ana'], tech: ['bo'] } },
    changes: 'direct',
  }),
  'design/tokens/primitives/color.tokens.json': json({ color: { navy: { 900: color('#0a1f44') }, white: color('#ffffff'), sky: { 500: color('#3b82f6') } } }),
  'design/tokens/brands/acme.tokens.json': json({ $extensions: { 'dev.bridge.brand': { name: 'ACME Corp' } }, palette: { ink: { $type: 'color', $value: '{color.navy.900}' } } }),
  'design/tokens/brands/night-owl.tokens.json': json({ palette: { ink: { $type: 'color', $value: '{color.sky.500}' } } }),
  'design/tokens/semantic/light.tokens.json': json({ color: { text: { default: { $type: 'color', $value: '{palette.ink}', $description: 'Body text' } }, bg: { default: { $type: 'color', $value: '{color.white}' } } } }),
  'design/tokens/semantic/dark.tokens.json': json({ color: { text: { default: { $type: 'color', $value: '{color.white}' } }, bg: { default: { $type: 'color', $value: '{color.navy.900}' } } } }),
  'design/tokens/density/comfortable.tokens.json': json({ control: { height: dim(40) } }),
  'design/tokens/density/compact.tokens.json': json({ control: { height: dim(32) } }),
  'design/tokens/pairs.json': json({ pairs: [['color.text.default', 'color.bg.default', 4.5]] }),
  'design/tokens/notes.json': json({ 'color.text': 'Words on surfaces' }),
  'src/main.ts': "// Actions\nexport * from './ui/Button';\n",
  'src/ui/Button/Button.tsx': "export interface ButtonProps {\n  /** Look. */\n  variant?: 'solid' | 'ghost';\n}\n\nexport function Button({ variant = 'solid' }: ButtonProps) {}\n",
  'src/ui/Button/Button.module.css': '.root { color: var(--color-text-default); min-height: var(--control-height); }',
  'src/ui/Button/Button.docs.json': json({ summary: 'Starts an action' }),
  'src/ui/Button/Button.test.tsx': 'never read by the model',
  'src/specs.json': json({ version: 1, generated: 'by bridge specs', components: [{ name: 'Button', big: 'x'.repeat(5000) }], coverage: [{ name: 'Button', status: 'generated' }] }),
  'README.md': 'not part of the model',
};

async function teamSnapshot(files = TEAM): Promise<{ snapshot: RepoSnapshot; live: Awaited<ReturnType<typeof loadRepoModel>> }> {
  const rec = recordingSource(memorySource(files, { owner: 'acme', repo: 'design', sha: 'c0ffee' }));
  const live = await loadRepoModel(rec.source);
  const snapshot = buildSnapshot({ model: live, paths: rec.paths, files: rec.files, version: '9.9.9', generatedAt: '2026-10-21T00:00:00.000Z', committedAt: '2026-10-20T00:00:00Z' });
  return { snapshot, live };
}

test('a snapshot carries what the model read, and only that', async () => {
  const { snapshot } = await teamSnapshot();
  assert.equal(snapshot.kind, 'bridge-snapshot');
  assert.equal(snapshot.schemaVersion, SNAPSHOT_SCHEMA_VERSION);
  assert.deepEqual(snapshot.repo, { owner: 'acme', name: 'design', branch: 'trunk' });
  assert.equal(snapshot.sourceSha, 'c0ffee');
  assert.equal(snapshot.committedAt, '2026-10-20T00:00:00Z');
  assert.deepEqual(snapshot.problems, []);
  assert.ok(Object.keys(snapshot.files).includes('bridge.config.json'));
  assert.ok(Object.keys(snapshot.files).includes('design/tokens/notes.json'));
  assert.ok(Object.keys(snapshot.files).includes('src/main.ts'));
  assert.deepEqual(Object.keys(snapshot.files).filter((p) => p.startsWith('src/ui/')), ['src/ui/Button/Button.docs.json', 'src/ui/Button/Button.module.css', 'src/ui/Button/Button.tsx']);
  // Listed (so the scan sees the folder as it is) but not read.
  assert.ok(snapshot.paths.includes('src/ui/Button/Button.test.tsx'));
  assert.ok(!snapshot.paths.includes('README.md'));
  // The specs file is not copied: its coverage is.
  assert.ok(!('src/specs.json' in snapshot.files));
  assert.deepEqual(snapshot.figma, { path: 'src/specs.json', generated: 'by bridge specs', coverage: [{ name: 'Button', status: 'generated' }] });
  // 2 brands x 2 themes; night-owl's sky ink on white is under 4.5:1.
  assert.deepEqual(snapshot.summary, { tokens: snapshot.summary.tokens, components: 1, contrast: { pairs: 1, checks: 4, failing: 1 }, figma: { inFigma: 1, visual: 1 } });
  // Contrast results without the token rows.
  assert.equal(snapshot.contrast.path, 'design/tokens/pairs.json');
  assert.equal(snapshot.contrast.pairs[0]!.fg, 'color.text.default');
  assert.ok(!('fgToken' in snapshot.contrast.pairs[0]!));
});

test('round trip: the model from the snapshot equals the live model, Figma specs aside', async () => {
  const { snapshot, live } = await teamSnapshot();
  const parsed = parseSnapshot(JSON.stringify(snapshot));
  const fromSnapshot = await loadRepoModel(snapshotSource(parsed));
  assert.deepEqual(fromSnapshot.ref, { owner: 'acme', repo: 'design', sha: 'c0ffee' });
  assert.equal(fromSnapshot.specs.file, null, 'the full specs are not in the snapshot');
  assert.deepEqual(fromSnapshot.specs.coverage, live.specs.coverage);
  assert.deepEqual({ ...fromSnapshot, specs: live.specs }, live);
});

test('a repo without specs: figma is null and the model has no coverage', async () => {
  const files = { ...TEAM };
  delete files['src/specs.json'];
  const { snapshot } = await teamSnapshot(files);
  assert.equal(snapshot.figma, null);
  assert.equal(snapshot.summary.figma, null);
  const model = await loadRepoModel(snapshotSource(snapshot));
  assert.deepEqual(model.specs.coverage, []);
});

test('this repo: the snapshot is under 1 MB and serves the same model as the checkout', async () => {
  const root = join(__dirname, '../../..');
  const rec = recordingSource(fsSource(root, { owner: 'peterbono', repo: 'ai-design-system-demo', sha: 'local' }));
  const live = await loadRepoModel(rec.source);
  const snapshot = buildSnapshot({ model: live, paths: rec.paths, files: rec.files, version: 'test' });
  const text = JSON.stringify(snapshot);
  // component-specs.json alone is over 1 MB; the snapshot carries its coverage only.
  assert.ok(text.length < 1_000_000, `snapshot is ${text.length} bytes`);
  assert.ok(snapshot.figma && snapshot.figma.coverage.length > 20);
  const fromSnapshot = await loadRepoModel(snapshotSource(parseSnapshot(text)));
  assert.deepEqual({ ...fromSnapshot, specs: live.specs }, live);
  assert.deepEqual(fromSnapshot.specs.coverage, live.specs.coverage);
});

test('parseSnapshot names what is wrong', () => {
  assert.throws(() => parseSnapshot('{'), SnapshotError);
  assert.throws(() => parseSnapshot({ kind: 'other' }), /not a Bridge snapshot/);
  assert.throws(() => parseSnapshot({ kind: 'bridge-snapshot', schemaVersion: 2 }), /schema version 2/);
  assert.throws(() => parseSnapshot({ kind: 'bridge-snapshot', schemaVersion: 1, repo: { owner: 'a', name: 'b', branch: 'main' } }), /sourceSha/);
});

test('freshness: the snapshot stands in for a live read only at the same head', async () => {
  const { snapshot } = await teamSnapshot();
  assert.equal(snapshotIsFresh(snapshot, 'c0ffee'), true);
  assert.equal(snapshotIsFresh(snapshot, 'beef'), false);
  assert.equal(snapshotIsFresh(snapshot, undefined), false);
});

test('audits: a summary in snapshot.json, the report in audits/<id>.json', () => {
  assert.equal(auditId('admin-after.json'), 'admin-after');
  assert.equal(auditId('Bridge admin, main'), 'bridge-admin-main');
  assert.equal(auditId('../..'), 'audit');
  const report = { schemaVersion: 1, label: 'Admin', generatedAt: '2026-10-21T00:00:00Z', target: { path: 'apps/admin/src', files: 3, skipped: 0 }, metrics: { tokenAdoption: 90 }, files: [] } as unknown as AuditReport;
  assert.deepEqual(snapshotAudit('admin', report), { id: 'admin', path: 'audits/admin.json', label: 'Admin', generatedAt: '2026-10-21T00:00:00Z', target: { path: 'apps/admin/src', files: 3 }, metrics: { tokenAdoption: 90 } });
});
