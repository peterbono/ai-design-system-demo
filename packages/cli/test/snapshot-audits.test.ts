// bridge snapshot --audit / --audit-report: each audit names the bridge.config.json product it measured, so Studio's
// "Used in" lists the team's products, never other apps of the repository or the library itself.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RepoSnapshot } from '@bridge-ds/core';
import { writeSnapshot } from '../src/snapshot.js';
import { REPO } from '../../mcp/test/helpers.js';

const CLEAN_APP = join(REPO, 'packages/core/test/fixtures/audit/clean-app');

describe('bridge snapshot audits name their product', () => {
  it('a product checkout next to the repo is named by its git origin; other folders name none', async () => {
    // This repository's config: Art print shop (key admin-app) lives in the-bridge-company/art-print-shop.
    const shop = mkdtempSync(join(tmpdir(), 'bridge-test-shop-'));
    cpSync(CLEAN_APP, shop, { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd: shop });
    execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/the-bridge-company/art-print-shop.git'], { cwd: shop });
    // A carried report of an app of this repository that is no listed product (the admin demo).
    const reports = mkdtempSync(join(tmpdir(), 'bridge-test-reports-'));
    const report = JSON.parse(readFileSync(join(REPO, 'apps/docs-site/src/data/audits/admin-after.json'), 'utf8')) as Record<string, unknown>;
    writeFileSync(join(reports, 'admin-after.json'), JSON.stringify(report));

    const out = mkdtempSync(join(tmpdir(), 'bridge-test-snapshot-'));
    await writeSnapshot({ root: REPO, out, version: '9.9.9', generatedAt: '2026-11-03T10:00:00.000Z', auditReports: [reports], audit: [`${shop}=Art print shop, main`, 'packages/core/test/fixtures/audit/clean-app=Library fixture'] });
    const snap = JSON.parse(readFileSync(join(out, 'snapshot.json'), 'utf8')) as RepoSnapshot;
    const byId = Object.fromEntries(snap.audits.map((a) => [a.id, a.product ?? null]));
    expect(byId).toEqual({ 'admin-after': null, 'art-print-shop-main': 'admin-app', 'library-fixture': null });
  });

  it('a product checkout inside the repo (actions/checkout path:) is named by its own git origin', async () => {
    // Under node_modules (ignored by git): a nested repository, as the bridge-data workflow checks the product out.
    const cache = join(REPO, 'node_modules/.cache');
    mkdirSync(cache, { recursive: true });
    const shop = mkdtempSync(join(cache, 'bridge-test-nested-shop-'));
    try {
      cpSync(CLEAN_APP, shop, { recursive: true });
      execFileSync('git', ['init', '-q'], { cwd: shop });
      execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/the-bridge-company/art-print-shop'], { cwd: shop });
      const out = mkdtempSync(join(tmpdir(), 'bridge-test-snapshot-'));
      await writeSnapshot({ root: REPO, out, version: '9.9.9', generatedAt: '2026-11-03T10:00:00.000Z', audit: [`${relative(REPO, shop)}=Art print shop, main`] });
      const snap = JSON.parse(readFileSync(join(out, 'snapshot.json'), 'utf8')) as RepoSnapshot;
      expect(snap.audits.map((a) => a.product ?? null)).toEqual(['admin-app']);
    } finally {
      rmSync(shop, { recursive: true, force: true });
    }
  });
});
