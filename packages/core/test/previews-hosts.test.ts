// Previews on any host: Cloudflare Pages (check runs, its alias rule), Netlify (commit statuses), any host that
// reports GitHub deployments, and Vercel unchanged.
import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  appForUrl,
  branchPreviewUrl,
  cloudflareBranchAlias,
  isCloudflareCheck,
  parseCloudflareCheck,
  previewHostOf,
  previewUrl,
  resolveBranchPreviews,
  type PreviewCheckRun,
} from '../src/previews';

const CF_SUMMARY = [
  '## Deploying with &nbsp;<a href="https://pages.dev"><img alt="Cloudflare Pages" src="https://user-images.githubusercontent.com/23264/106598434-9e719e00-654f-11eb-9e59-6167043cfa01.png" width="16"></a> &nbsp;Cloudflare Pages',
  '',
  '<table><tr><td><strong>Latest commit:</strong> </td><td>',
  '<code>ad2a9d3</code>',
  '</td></tr>',
  '<tr><td><strong>Status:</strong></td><td>&nbsp;✅&nbsp; Deploy successful!</td></tr>',
  '</table>',
  '',
  '| Name | Status | Preview URL | Updated (UTC) |',
  '',
  '| Latest commit: | ad2a9d3 |',
  '| Status: | ✅  Deploy successful! |',
  '| Preview URL: | https://4f2c1a9b.art-print-shop-design.pages.dev |',
  '| Branch Preview URL: | https://explore-add-a-toast-alert.art-print-shop-design.pages.dev |',
].join('\n');

const cfRun = (over: Partial<PreviewCheckRun> = {}): PreviewCheckRun => ({ name: 'Cloudflare Pages', status: 'completed', conclusion: 'success', app: 'cloudflare-workers-and-pages', summary: CF_SUMMARY, ...over });

test('previewHostOf names the host from the domain', () => {
  assert.equal(previewHostOf('https://shop-git-{branch}-team.vercel.app'), 'vercel');
  assert.equal(previewHostOf('https://{branch}.shop.pages.dev'), 'cloudflare');
  assert.equal(previewHostOf('https://deploy-preview-{pr}--shop.netlify.app'), 'netlify');
  assert.equal(previewHostOf('https://staging.example.com/{branch}'), 'other');
  assert.equal(previewHostOf(null), 'other');
});

test("cloudflareBranchAlias: Cloudflare's rule, cut to 28 characters", () => {
  assert.equal(cloudflareBranchAlias('fix/api'), 'fix-api');
  assert.equal(cloudflareBranchAlias('explore/add-a-toast-alert'), 'explore-add-a-toast-alert');
  assert.equal(cloudflareBranchAlias('Feat/Big__Thing'), 'feat-big--thing');
  assert.equal(cloudflareBranchAlias('explore/dashboard-orders-waiting-to-ship'), 'explore-dashboard-orders-wai');
  assert.equal(cloudflareBranchAlias('explore/dashboard-orders-waiting-to-ship').length, 28);
  assert.equal(cloudflareBranchAlias('explore/abcdefghijklmnopqrst-x'), 'explore-abcdefghijklmnopqrst');
});

test('previewUrl and branchPreviewUrl fill a Cloudflare Pages template with its alias', () => {
  const tpl = 'https://{branch}.art-print-shop-design.pages.dev';
  assert.equal(previewUrl(tpl, { branch: 'explore/add-a-toast-alert' }), 'https://explore-add-a-toast-alert.art-print-shop-design.pages.dev/');
  assert.equal(branchPreviewUrl(tpl, 'explore/dashboard-orders-waiting-to-ship'), 'https://explore-dashboard-orders-wai.art-print-shop-design.pages.dev/');
  // Netlify pull request previews by number.
  assert.equal(previewUrl('https://deploy-preview-{pr}--shop.netlify.app', { branch: 'x', pr: 12 }), 'https://deploy-preview-12--shop.netlify.app/');
});

test('Vercel is unchanged: slug and the shortened alias', () => {
  assert.equal(previewUrl('https://shop-git-{branch}-team.vercel.app', { branch: 'Feat/Big__Thing' }), 'https://shop-git-feat-big-thing-team.vercel.app/');
  assert.equal(
    branchPreviewUrl('https://art-print-shop-design-git-{branch}-peterbonos-projects.vercel.app', 'explore/dashboard-orders-waiting-to-ship'),
    'https://art-print-shop-design-git-explore-da-6e68e5-peterbonos-projects.vercel.app/',
  );
});

test('parseCloudflareCheck reads the branch alias and the commit deployment', () => {
  assert.deepEqual(parseCloudflareCheck(cfRun()), {
    branchUrl: 'https://explore-add-a-toast-alert.art-print-shop-design.pages.dev/',
    commitUrl: 'https://4f2c1a9b.art-print-shop-design.pages.dev/',
  });
  assert.equal(parseCloudflareCheck({ summary: 'Build failed', text: null }), null);
  assert.ok(isCloudflareCheck(cfRun()));
  assert.ok(isCloudflareCheck({ name: 'Cloudflare Pages', app: null }));
  assert.ok(!isCloudflareCheck({ name: 'Tests', app: 'github-actions' }));
});

test('appForUrl matches a URL to the template whose host it fits', () => {
  const apps = { admin: 'https://{branch}.art-print-shop-design.pages.dev', docs: 'https://docs-git-{branch}-team.vercel.app' };
  assert.equal(appForUrl('https://explore-x.art-print-shop-design.pages.dev/', apps), 'admin');
  assert.equal(appForUrl('https://4f2c1a9b.art-print-shop-design.pages.dev', apps), 'admin');
  assert.equal(appForUrl('https://docs-git-explore-x-team.vercel.app', apps), 'docs');
  assert.equal(appForUrl('https://art-print-shop-design.pages.dev', apps), null);
  assert.equal(appForUrl('https://elsewhere.example.com', apps), null);
});

test('resolveBranchPreviews: Cloudflare Pages check run gives the branch alias and the state', () => {
  const apps = { admin: 'https://{branch}.art-print-shop-design.pages.dev' };
  const ctx = { branch: 'explore/add-a-toast-alert', pr: 4, sha: 'ad2a9d3' };
  const [ready] = resolveBranchPreviews(apps, ctx, { checkRuns: [cfRun()] });
  assert.equal(ready!.url, 'https://explore-add-a-toast-alert.art-print-shop-design.pages.dev/');
  assert.equal(ready!.state, 'ready');
  assert.equal(ready!.source, 'check');
  const [building] = resolveBranchPreviews(apps, ctx, { checkRuns: [cfRun({ status: 'in_progress', conclusion: null, summary: '## Deploying with Cloudflare Pages\n| Status: | ⚡️ Build in progress... |' })] });
  assert.equal(building!.state, 'building');
  // No URL reported yet: the template's alias stands in.
  assert.equal(building!.url, 'https://explore-add-a-toast-alert.art-print-shop-design.pages.dev/');
  assert.equal(building!.source, 'template');
  const [failed] = resolveBranchPreviews(apps, ctx, { checkRuns: [cfRun({ conclusion: 'failure', summary: '## Deploying with Cloudflare Pages\n| Status: | ❌ Deployment failed |' })] });
  assert.equal(failed!.state, 'failed');
  // A long branch: the real alias reported beats the guess.
  const long = { branch: 'explore/dashboard-orders-waiting-to-ship', pr: 1, sha: 'x' };
  const [lp] = resolveBranchPreviews(apps, long, { checkRuns: [cfRun({ summary: '| Branch Preview URL: | https://explore-dashboard-orders-wai.art-print-shop-design.pages.dev |' })] });
  assert.equal(lp!.url, 'https://explore-dashboard-orders-wai.art-print-shop-design.pages.dev/');
});

test('resolveBranchPreviews: a Netlify commit status gives its deploy preview', () => {
  const apps = { admin: 'https://deploy-preview-{pr}--shop.netlify.app' };
  const [p] = resolveBranchPreviews(apps, { branch: 'explore/x', pr: 12, sha: 's' }, {
    statuses: [{ context: 'netlify/shop/deploy-preview', state: 'success', target_url: 'https://deploy-preview-12--shop.netlify.app', description: 'Deploy Preview ready!' }],
  });
  assert.equal(p!.url, 'https://deploy-preview-12--shop.netlify.app/');
  assert.equal(p!.state, 'ready');
  assert.equal(p!.source, 'status');
  const [pending] = resolveBranchPreviews(apps, { branch: 'explore/x', pr: 12 }, { statuses: [{ context: 'netlify/shop/deploy-preview', state: 'pending', target_url: 'https://app.netlify.com/sites/shop/deploys/abc' }] });
  assert.equal(pending!.state, 'unknown');
});

test('resolveBranchPreviews: any host reporting GitHub deployments, production left out', () => {
  const apps = { admin: 'https://{branch}.shop.pages.dev' };
  const ctx = { branch: 'explore/x', pr: 3, sha: 's' };
  const [p] = resolveBranchPreviews(apps, ctx, { deployments: [{ environment: 'Preview', state: 'success', environmentUrl: 'https://9a8b7c6d.shop.pages.dev' }] });
  assert.equal(p!.url, 'https://9a8b7c6d.shop.pages.dev/');
  assert.equal(p!.source, 'deployment');
  assert.equal(p!.state, 'ready');
  const [prod] = resolveBranchPreviews(apps, ctx, { deployments: [{ environment: 'Production', state: 'success', environmentUrl: 'https://main.shop.pages.dev' }] });
  assert.equal(prod!.source, 'template');
});

test('resolveBranchPreviews: Vercel sources are read exactly as before', () => {
  const apps = { admin: 'https://bridge-admin-git-{branch}-peterbonos-projects.vercel.app' };
  const ctx = { branch: 'explore/x', pr: 9, sha: 's' };
  const [p] = resolveBranchPreviews(apps, ctx, {
    statuses: [{ context: 'Vercel – bridge-admin', state: 'success', target_url: 'https://vercel.com/peterbonos-projects/bridge-admin/AbC123' }],
    checkRuns: [{ name: 'Vercel', status: 'completed', conclusion: 'success', app: 'vercel' }],
  });
  assert.equal(p!.url, 'https://bridge-admin-git-explore-x-peterbonos-projects.vercel.app/');
  assert.equal(p!.state, 'ready');
});
