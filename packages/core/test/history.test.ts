import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { afterAll, beforeAll, test } from 'vitest';
import { loadConfig } from '../src/config';
import { GitHubClient } from '../src/github-client';
import { type HistoryReport, buildHistoryEntry, filterHistory, fileModes, mergeReleases, parseChangelog, parseChangesetText, planRestore, planRevert, planToJson, releasesFromTags, tokenHistory, versionTimeline } from '../src/history';
import { loadGitHubHistory } from '../src/history-github';
import { LayeredTokenSet } from '../src/layered';
import { applyTokenEdits } from '../src/token-edits';
import { parseContrastChecks } from '../src/wcag';
import { loadLocalHistory } from '../src/node/git-history';
import { type Fixture, DARK, LIGHT, historyFixture } from './history-fixture';
import { realChecksText, realConfig } from './helpers';

let fx: Fixture;
let report: HistoryReport;
const config = () => loadConfig(fx.git('show', 'HEAD:bridge.config.json'));
const current = () => new LayeredTokenSet(config(), fx.head);
const pairs = () => parseContrastChecks(realChecksText());
const entry = (id: string) => report.entries.find((e) => e.id === id)!;

beforeAll(async () => {
  fx = historyFixture();
  report = await loadLocalHistory(fx.dir, config(), { ref: 'main' });
}, 30000);
afterAll(() => rmSync(fx.dir, { recursive: true, force: true }));

test('local history: first-parent entries, PR numbers, why from the changeset, bulk import flagged', () => {
  assert.deepEqual(report.entries.map((e) => e.id), ['pr-8', 'pr-7', 'pr-5', 'pr-3', fx.sha.init.slice(0, 7)]);
  const e3 = entry('pr-3');
  assert.equal(e3.title, 'feat(tokens): darken muted text (#3)');
  assert.equal(e3.why, 'Muted text was too light on subtle surfaces; darken it one step in light.');
  assert.deepEqual(e3.changes.map((c) => [c.kind, c.path, c.file, c.before, c.after]), [['changed', 'color.text.muted', LIGHT, '{palette.neutral.600}', '{palette.neutral.700}']]);
  assert.deepEqual([e3.tier, e3.bump, e3.breaking], [3, 'minor', false]);
  assert.equal(e3.changesets[0]!.path, '.changeset/darken-muted.md');
  // The merge commit is one entry for the whole branch, titled from the merge body.
  const e5 = entry('pr-5');
  assert.equal(e5.sha, fx.sha.pr5);
  assert.equal(e5.title, 'Add subtle text token');
  assert.deepEqual(e5.counts, { added: 2, changed: 0, removed: 0, renamed: 0, total: 2 });
  assert.equal(entry('pr-8').breaking, true);
  assert.equal(entry('pr-8').counts.renamed, 2);
  assert.equal(report.entries.at(-1)!.bulk, true);
  assert.equal(report.currentVersion, '0.2.0');
  assert.equal(report.truncated, false);
});

test('versions: tags date the releases, later changes are Unreleased; timeline newest first', () => {
  assert.deepEqual(report.entries.map((e) => e.version), ['Unreleased', 'Unreleased', '0.2.0', '0.2.0', '0.2.0']);
  const t = report.timeline;
  assert.deepEqual(t.map((g) => g.version), ['Unreleased', '0.2.0']);
  assert.deepEqual(t[0]!.prs, [8, 7]);
  assert.equal(t[0]!.breaking, true);
  assert.equal(t[0]!.bump, 'major');
  assert.equal(t[1]!.pending, false);
});

test('changelog, tags and changesets parse', () => {
  const rel = parseChangelog('# @demo-ds/tokens\n\n## 1.1.0\n\n### Minor Changes\n\n- 1a2b3c4: Darken muted text ([#3](https://github.com/acme/ds/pull/3))\n\n## 1.0.0\n\n- Initial release\n');
  assert.deepEqual(rel.map((r) => [r.version, r.shas, r.prs]), [['1.1.0', ['1a2b3c4'], [3]], ['1.0.0', [], []]]);
  assert.deepEqual(releasesFromTags([{ name: 'v1.0.0' }, { name: '@demo-ds/tokens@1.1.0' }, { name: '@demo-ds/react@9.0.0' }, { name: 'nightly' }], '@demo-ds/tokens').map((r) => r.version), ['1.0.0', '1.1.0']);
  assert.equal(mergeReleases(rel, [{ version: '1.1.0', date: '2026-01-01' }]).find((r) => r.version === '1.1.0')!.date, '2026-01-01');
  assert.deepEqual(parseChangesetText('.changeset/a.md', '---\n"@demo-ds/tokens": major\n---\n\nRemove the old link token.\n\nMore.'), { path: '.changeset/a.md', bump: 'major', packages: ['@demo-ds/tokens'], summary: 'Remove the old link token.' });
  // The CHANGELOG wins over the tag date.
  const e = { ...entry('pr-7') };
  const withCl = versionTimeline([{ ...e, version: undefined }], []);
  assert.equal(withCl[0]!.version, 'Unreleased');
});

test('filters and per-token history follow renames', () => {
  assert.deepEqual(filterHistory(report.entries, { token: 'color.text.muted' }).map((e) => e.id).slice(0, 2), ['pr-7', 'pr-3']);
  assert.deepEqual(filterHistory(report.entries, { tier: 3, breaking: true }).map((e) => e.id), ['pr-8']);
  assert.deepEqual(filterHistory(report.entries, { author: 'ada', version: '0.2.0' }).length, 3);
  assert.deepEqual(filterHistory(report.entries, { query: '#5' }).map((e) => e.id), ['pr-5']);
  const muted = tokenHistory(report.entries, 'color.text.muted', config());
  assert.deepEqual(muted.map((m) => [m.entryId, m.kind, m.modeLabel]), [['pr-7', 'changed', 'Light'], ['pr-3', 'changed', 'Light'], [fx.sha.init.slice(0, 7), 'added', 'Dark'], [fx.sha.init.slice(0, 7), 'added', 'Light']]);
  assert.match(muted[0]!.afterCss!, /^#[0-9a-f]{6}$/);
  const anchor = tokenHistory(report.entries, 'color.text.anchor', config());
  assert.deepEqual(anchor.map((m) => [m.entryId, m.kind, m.from ?? m.path]).slice(0, 2), [['pr-8', 'renamed', 'color.text.link'], ['pr-8', 'renamed', 'color.text.link']]);
  assert.ok(anchor.some((m) => m.kind === 'added' && m.path === 'color.text.link'), 'older entries under the old name');
  assert.deepEqual(fileModes(config(), 'brands/ocean.dark.tokens.json'), { brand: 'ocean', theme: 'dark' });
  assert.deepEqual(fileModes(config(), 'primitives/color.tokens.json'), {});
});

test('revert with a conflict: the token changed again later, kept unless asked', () => {
  const later = report.entries.filter((e) => Date.parse(e.date) > Date.parse(entry('pr-3').date));
  const plan = planRevert({ current: current(), entry: entry('pr-3'), later, pairs: pairs() });
  assert.equal(plan.status, 'nothing-to-do');
  assert.equal(plan.conflicts.length, 1);
  const k = plan.conflicts[0]!;
  assert.equal(k.reason, 'changed-later');
  assert.deepEqual(k.later.map((l) => l.pr), [7]);
  assert.equal(k.current!.value, '{palette.neutral.800}');
  assert.equal(k.resolution, 'keep-current');

  const forced = planRevert({ current: current(), entry: entry('pr-3'), later, pairs: pairs(), resolutions: { [k.key]: 'use-before' } });
  assert.equal(forced.status, 'ready');
  assert.deepEqual(forced.edits, [{ op: 'set', path: 'color.text.muted', file: LIGHT, value: '{palette.neutral.600}' }]);
  assert.equal(forced.prTitle, 'Revert: feat(tokens): darken muted text (#3)');
  assert.match(forced.prBody, /Reverts \[#3\]\(https:\/\/github\.com\/acme\/ds\/pull\/3\)/);
  assert.match(forced.prBody, /### Conflicts/);
  assert.match(forced.prBody, /- \[x\] Tier 3/);
  assert.ok(forced.contrast.length > 0, 'contrast before and after');
  assert.deepEqual(forced.files.map((f) => f.path), [`packages/tokens/src/${LIGHT}`, '.changeset/bridge-revert-feat-tokens-darken-muted-text-3.md']);
  assert.ok(forced.branch.startsWith('bridge/revert-'));
  assert.doesNotMatch(forced.prBody, /—/);
  // Minimal diff: one line changes in the token file.
  const before = fx.head.get(LIGHT)!.split('\n');
  const after = forced.files[0]!.content.split('\n');
  assert.equal(after.filter((l, i) => l !== before[i]).length, 1);
  assert.equal(planToJson(forced).bridge, 'change-plan');
});

test('revert without conflicts: an addition is removed in light and dark, breaking', () => {
  const plan = planRevert({ current: current(), entry: entry('pr-5'), later: report.entries, pairs: pairs() });
  assert.equal(plan.status, 'ready');
  assert.deepEqual(plan.edits.map((e) => [e.op, e.path, e.file]), [['remove', 'color.text.subtle', DARK], ['remove', 'color.text.subtle', LIGHT]]);
  assert.deepEqual([plan.tier.tier, plan.tier.bump], [3, 'major']);
  assert.equal(plan.newErrors.length, 0);
});

test('revert a rename: one rename back that repoints aliases', () => {
  const plan = planRevert({ current: current(), entry: entry('pr-8'), later: [] });
  assert.equal(plan.status, 'ready');
  assert.deepEqual(plan.edits, [{ op: 'rename', path: 'color.text.anchor', newPath: 'color.text.link' }]);
  assert.equal(plan.skipped.length, 1);
  assert.deepEqual(plan.newErrors, []);
});

test('already reverted changes are skipped; still-referenced additions conflict', () => {
  const cfg = config();
  const set = current();
  const reverted = applyTokenEdits(set, [{ op: 'set', path: 'color.text.muted', value: '{palette.neutral.600}', file: LIGHT }]).files;
  const plan = planRevert({ current: new LayeredTokenSet(cfg, reverted), entry: entry('pr-7'), later: [] });
  // pr-7 moved 700 -> 800; muted is now 600, so it changed again: a conflict, not a skip.
  assert.equal(plan.conflicts[0]!.reason, 'changed-later');
  const at700 = applyTokenEdits(set, [{ op: 'set', path: 'color.text.muted', value: '{palette.neutral.700}', file: LIGHT }]).files;
  assert.equal(planRevert({ current: new LayeredTokenSet(cfg, at700), entry: entry('pr-7') }).skipped.length, 1);
  const using = applyTokenEdits(set, [{ op: 'add', path: 'color.text.hint', value: '{color.text.subtle}', file: LIGHT }]);
  const p = planRevert({ current: new LayeredTokenSet(cfg, using.files), entry: entry('pr-5') });
  assert.deepEqual(p.conflicts.map((c) => [c.reason, c.file]), [['still-referenced', LIGHT]]);
  assert.deepEqual(p.edits.map((e) => e.file), [DARK]);
});

test('restore one token to an older value; a value that breaks contrast is blocked', () => {
  const item = tokenHistory(report.entries, 'color.text.muted', config()).find((m) => m.entryId === 'pr-3')!;
  const plan = planRestore({ current: current(), path: 'color.text.muted', file: LIGHT, value: item.after, label: '#3', item, pairs: pairs() });
  assert.equal(plan.status, 'ready');
  assert.equal(plan.title, 'Restore color.text.muted (Light) from #3');
  assert.deepEqual(plan.edits, [{ op: 'set', path: 'color.text.muted', file: LIGHT, value: '{palette.neutral.700}' }]);
  assert.match(plan.prBody, /That value came from \[#3\]/);
  const bad = planRestore({ current: current(), path: 'color.text.muted', file: LIGHT, value: '{palette.neutral.300}', pairs: pairs() });
  assert.equal(bad.status, 'blocked');
  assert.match(bad.why!, /contrast/);
  assert.throws(() => planRestore({ current: current(), path: 'color.text.muted', value: '#000000' }), /Pass the file/);
});

test('buildHistoryEntry: no token change gives no entry', () => {
  const files = new Map(fx.head);
  assert.equal(buildHistoryEntry({ config: realConfig(), commit: { sha: 'a', parents: [], date: '2026-01-01T00:00:00Z', author: 'x', subject: 'chore: format' }, before: files, after: files }), null);
});

// GitHub over REST, served from the fixture repo: commits API lists branch commits too, and each commit
// finds its PR; the PR's merge commit is the entry.
test('GitHub history: commits folded into their PR, versions from tags', async () => {
  const run = (...a: string[]) => execFileSync('git', a, { cwd: fx.dir, encoding: 'utf8' });
  const prs: Record<string, { number: number; title: string; merge: string }> = {
    [fx.sha.pr3]: { number: 3, title: 'Darken muted text', merge: fx.sha.pr3 },
    [fx.sha.pr5branch]: { number: 5, title: 'Add subtle text', merge: fx.sha.pr5 },
    [fx.sha.pr5]: { number: 5, title: 'Add subtle text', merge: fx.sha.pr5 },
    [fx.sha.pr7]: { number: 7, title: 'Muted text even darker', merge: fx.sha.pr7 },
    [fx.sha.pr8]: { number: 8, title: 'Rename link text to anchor', merge: fx.sha.pr8 },
  };
  const info = (sha: string) => {
    const [h, p, d, a, ...m] = run('show', '-s', '--format=%H%n%P%n%cI%n%an%n%B', sha).split('\n');
    return { sha: h, parents: p!.split(' ').filter(Boolean).map((x) => ({ sha: x })), author: { login: a!.toLowerCase() }, commit: { message: m.join('\n').trim(), committer: { date: d } } };
  };
  const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body), headers: { get: () => null } });
  const fetchImpl = async (url: string) => {
    const u = new URL(url);
    const p = u.pathname.replace('/repos/acme/ds', '');
    let m: RegExpExecArray | null;
    if (p === '/commits') {
      const shas = run('log', '--format=%H', u.searchParams.get('sha')!, '--', u.searchParams.get('path')!).split('\n').filter(Boolean);
      const page = Number(u.searchParams.get('page') ?? 1);
      const per = Number(u.searchParams.get('per_page'));
      return json(shas.slice((page - 1) * per, page * per).map(info));
    }
    if ((m = /^\/commits\/([0-9a-f]+)\/pulls$/.exec(p))) {
      const pr = prs[m[1]!];
      return json(pr ? [{ number: pr.number, title: pr.title, state: 'closed', merged_at: info(pr.merge).commit.committer.date, merge_commit_sha: pr.merge, user: { login: 'ada' }, head: {}, base: { ref: 'main' }, labels: [], html_url: `https://github.com/acme/ds/pull/${pr.number}`, body: `Why #${pr.number}.` }] : []);
    }
    if ((m = /^\/commits\/([0-9a-f]+)$/.exec(p))) return json(info(m[1]!));
    if ((m = /^\/git\/commits\/([0-9a-f]+)$/.exec(p))) return json({ tree: { sha: run('rev-parse', `${m[1]}^{tree}`).trim() } });
    if ((m = /^\/git\/trees\/([0-9a-f]+)$/.exec(p))) {
      const tree = run('ls-tree', '-r', m[1]!).split('\n').filter(Boolean).map((l) => {
        const [meta, path] = l.split('\t');
        const [mode, type, sha] = meta!.split(' ');
        return { path, mode, type, sha };
      });
      return json({ tree, truncated: false });
    }
    if ((m = /^\/git\/blobs\/([0-9a-f]+)$/.exec(p))) return json({ encoding: 'base64', content: Buffer.from(run('cat-file', 'blob', m[1]!)).toString('base64') });
    if (p === '/git/ref/heads/main') return json({ object: { sha: fx.sha.pr8 } });
    if (p === '/tags') return json([{ name: 'v0.2.0', commit: { sha: fx.sha.pr5 } }]);
    return json({ message: 'not found' }, 404);
  };
  const client = new GitHubClient('acme/ds', '', fetchImpl);
  const gh = await loadGitHubHistory(client, config(), { ref: 'main', limit: 20 });
  assert.deepEqual(gh.entries.map((e) => e.id), ['pr-8', 'pr-7', 'pr-5', 'pr-3', fx.sha.init.slice(0, 7)]);
  assert.equal(gh.entries.find((e) => e.id === 'pr-5')!.sha, fx.sha.pr5);
  assert.equal(gh.entries.find((e) => e.id === 'pr-5')!.title, 'Add subtle text');
  assert.equal(gh.entries.find((e) => e.id === 'pr-7')!.why, 'Why #7.');
  assert.equal(gh.entries.find((e) => e.id === 'pr-3')!.why, 'Muted text was too light on subtle surfaces; darken it one step in light.');
  assert.deepEqual(gh.timeline.map((t) => t.version), ['Unreleased', '0.2.0']);
  assert.equal(gh.currentVersion, '0.2.0');
}, 30000);

test('demo history: built backwards from the current files, flagged, revert of the older muted change conflicts', async () => {
  const { demoHistory } = await import('../src/history-demo');
  const cfg = realConfig();
  const files = new Map(Object.entries((await import('./helpers')).realFiles()));
  const demo = demoHistory(cfg, files);
  assert.equal(demo.demo, true);
  assert.ok(demo.entries.every((e) => e.demo && !e.pr?.url));
  assert.deepEqual(demo.entries.map((e) => e.id), ['pr-106', 'pr-104', 'pr-102', 'pr-101']);
  assert.deepEqual(demo.timeline.map((t) => t.version), ['Unreleased', '1.2.0', '1.1.0']);
  assert.equal(demo.entries.find((e) => e.id === 'pr-104')!.tier, 1);
  const set = new LayeredTokenSet(cfg, files);
  const plan = planRevert({ current: set, entry: demo.entries.find((e) => e.id === 'pr-101')!, later: demo.entries, pairs: pairs() });
  assert.equal(plan.conflicts[0]!.reason, 'changed-later');
  assert.deepEqual(plan.conflicts[0]!.later.map((l) => l.pr), [106]);
  const clean = planRevert({ current: set, entry: demo.entries[0]!, later: [], pairs: pairs() });
  assert.equal(clean.status, 'ready');
  assert.ok(clean.contrast.some((d) => d.fg === 'color.text.muted'));
});
