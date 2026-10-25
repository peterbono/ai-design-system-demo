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
  snapshotLlmsTxt,
  snapshotSource,
  SnapshotError,
  SNAPSHOT_MAX_RELEASES,
  SNAPSHOT_SCHEMA_VERSION,
  type RepoSnapshot,
} from '../src/snapshot';
import { collectReleases, releaseAnnouncement } from '../src/changelog-model';
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
  // Motion docs come from the full specs, which the snapshot does not carry: computed when it is written.
  assert.ok(snapshot.motion && Object.keys(snapshot.motion).length > 20);
  assert.ok(snapshot.motion.Button && snapshot.motion.Button.rows.some((r) => r.when === 'Hover'));
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

test('llms.txt: the design system as plain text, repo text kept on one line', async () => {
  const files = { ...TEAM, 'src/ui/Button/Button.docs.json': json({ summary: 'Starts an action\n# Not a heading', whenToUse: ['Saving a form'], whenNotToUse: ['Going to another page'], dos: [{ title: 'Name the outcome', text: 'Publish, not OK' }], donts: [], accessibility: ['Native button'] }) };
  const { snapshot, live } = await teamSnapshot(files);
  const text = snapshotLlmsTxt(live, snapshot);
  assert.match(text, /^# acme\/design design system\n/);
  assert.match(text, /read at c0ffee on trunk \(2026-10-20\)/);
  assert.match(text, /- `color\.text\.default` \(`--color-text-default`, semantic color\): light #0a1f44, dark #ffffff\. Body text/);
  assert.match(text, /### Button\n\nStarts an action # Not a heading\n/);
  assert.match(text, /- Use it for:\n {2}- Saving a form/);
  assert.match(text, /- Do: Name the outcome\. Publish, not OK/);
  assert.ok(!/\n# Not a heading/.test(text), 'repo text cannot open a heading');
  assert.ok(text.endsWith('\n') && !text.includes('\n\n\n'));
});

const SPEC_BUTTON = {
  name: 'Button',
  variants: [{ props: { State: 'Default' } }, { props: { State: 'Hover' } }],
  interactions: [
    {
      trigger: 'ON_HOVER',
      axis: 'State',
      from: 'Default',
      to: 'Hover',
      transition: { duration: 150, durationToken: 'motion.duration.fast', easing: { type: 'EASE_OUT' }, easingToken: 'motion.easing.standard', properties: ['background-color'] },
    },
  ],
};

const CHANGELOG = `# @acme/ui

## 1.1.0

### Minor Changes

- abc1234: Button gets a ghost variant. Use it on busy surfaces.

## 1.0.0

### Major Changes

- def5678: First stable release.
`;

test('extras: releases, packages and motion ride along, and an older snapshot without them still reads', async () => {
  const files = { ...TEAM, 'src/specs.json': json({ version: 1, components: [SPEC_BUTTON], coverage: [{ name: 'Button', status: 'generated' }] }) };
  const rec = recordingSource(memorySource(files, { owner: 'acme', repo: 'design', sha: 'c0ffee' }));
  const model = await loadRepoModel(rec.source);
  const releases = collectReleases({
    changelogs: [{ pkg: '@acme/ui', published: true, text: CHANGELOG }],
    changesets: [{ ref: '.changeset/tidy.md', text: '---\n"@acme/ui": patch\n---\n\nTooltip waits less before it opens.\n' }],
    dateOf: (_pkg, version) => (version === '1.1.0' ? '2026-10-01' : undefined),
    libraryPackage: '@acme/ui',
  });
  const packages = [
    { name: '@acme/web', version: '0.1.0', private: true, dir: 'apps/web' },
    { name: '@acme/ui', version: '1.1.0', private: false, dir: 'packages/ui' },
  ];
  const snapshot = buildSnapshot({ model, paths: rec.paths, files: rec.files, version: '9.9.9', releases, packages });
  assert.equal(snapshot.schemaVersion, 1, 'optional fields keep schema version 1');
  assert.deepEqual(
    snapshot.releases?.map((r) => [r.name, r.date ?? null, r.pending, r.entries.map((e) => e.kind)]),
    [
      ['Coming in the next release', null, true, ['Fix']],
      ['v1.1.0', '2026-10-01', false, ['New']],
      ['v1.0.0', null, false, ['Breaking']],
    ],
  );
  assert.match(releaseAnnouncement(snapshot.releases![1]!), /^Design system v1\.1\.0 is out:\n- New: Button gets a ghost variant/);
  assert.deepEqual(snapshot.packages?.map((p) => p.dir), ['apps/web', 'packages/ui']);
  assert.deepEqual(snapshot.motion?.Button?.rows, [{ when: 'Hover', what: 'Background', duration: { token: 'motion.duration.fast', value: '150 ms' }, easing: { token: 'motion.easing.standard', value: 'settles in place' } }]);
  const parsed = parseSnapshot(JSON.stringify(snapshot));
  assert.deepEqual(parsed.releases, JSON.parse(JSON.stringify(snapshot.releases)));
  // Model unchanged: the extras are beside the files, not in them.
  assert.deepEqual({ ...(await loadRepoModel(snapshotSource(parsed))), specs: model.specs }, model);

  const { releases: _r, packages: _p, motion: _m, ...older } = snapshot;
  assert.equal(parseSnapshot(JSON.stringify(older)).releases, undefined);
  assert.throws(() => parseSnapshot({ ...snapshot, releases: 'v1' }), /releases must be a list/);
  assert.throws(() => parseSnapshot({ ...snapshot, packages: [{ name: 'x' }] }), /packages must be a list/);
  assert.throws(() => parseSnapshot({ ...snapshot, motion: { Button: 'fast' } }), /motion must map/);
});

test('extras: releases are capped, a spec of an odd shape leaves out its motion, no specs means no motion', async () => {
  const many = Array.from({ length: SNAPSHOT_MAX_RELEASES + 5 }, (_, i) => ({ name: `v0.${i}.0`, pending: false, packages: [], entries: [] }));
  const { snapshot: odd, live } = await teamSnapshot();
  assert.deepEqual(odd.motion, {}, 'the fixture spec has no variants: skipped, not thrown');
  const capped = buildSnapshot({ model: live, paths: [], files: {}, version: 't', releases: many });
  assert.equal(capped.releases?.length, SNAPSHOT_MAX_RELEASES);
  assert.equal(capped.releases?.[0]?.name, 'v0.0.0');
  const files = { ...TEAM };
  delete files['src/specs.json'];
  const { snapshot } = await teamSnapshot(files);
  assert.equal(snapshot.motion, undefined);
  assert.equal(snapshot.releases, undefined);
  assert.equal(snapshot.packages, undefined);
});
