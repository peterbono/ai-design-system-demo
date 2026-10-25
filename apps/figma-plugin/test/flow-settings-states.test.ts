// Flow: Settings in its three states. A token pasted before Sign in with Bridge (a designer's legacy connection) shows
// one card and one action, Sign in with Bridge; after signing in, the card says who is connected through Bridge, with
// Open in Studio, Switch design system and Sign out; Sign out leads back to the not-connected screen. A designer never
// reads "GitHub repository", "token" or "owner/name" outside For developers.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openPlugin } from './ui-harness';

test('Settings: legacy token, then Sign in with Bridge, then Sign out', async () => {
  const p = await openPlugin({
    pulled: true,
    register: (routes) =>
      routes.push((method, path, body) => {
        if (path !== '/api/plugin-link' || method !== 'POST') return undefined;
        if (body.action === 'start') return { status: 200, body: { code: 'ABCDEFGH23', secret: 's'.repeat(43), url: 'https://bridge.floriangouloubi.com/studio/connect-figma/?code=ABCDEFGH23', expiresIn: 300, interval: 2 } };
        return { status: 200, body: { status: 'approved', repo: 'acme/acme-design-system', name: 'Acme DS', token: 'ghu_bridge', expiresAt: null, login: 'ana', defaultBranch: 'main' } };
      }),
  });
  const designerText = () => {
    const main = p.document.querySelector('main')!.cloneNode(true) as HTMLElement;
    main.querySelectorAll('details.dev-details').forEach((d) => d.remove());
    return (main.textContent ?? '').replace(/\s+/g, ' ');
  };
  const buttons = () => [...p.document.querySelectorAll('button')].map((b) => b.textContent?.trim());

  // 1. A token pasted earlier, no developer choice saved: one card, one primary action.
  await p.click('Settings');
  assert.ok(p.document.querySelector('[data-connection="legacy"]'), 'one card for the connection');
  assert.equal(p.primary()?.textContent?.trim(), 'Sign in with Bridge');
  assert.match(designerText(), /Connect through your team's Bridge account\. No token to manage\./);
  assert.doesNotMatch(designerText(), /GitHub repository|owner\/name|Replace token|Remove token/);
  assert.ok(!p.document.querySelector('main input'), 'no editable repository field');

  // 2. Sign in with Bridge: the old token is replaced by the Bridge sign-in.
  await p.click('Sign in with Bridge');
  await p.until(() => p.calls.includes('save-token'), 8000);
  await p.until(() => p.headline() === 'Get the latest design system' || p.text().includes('Pull'));
  await p.click('Settings');
  await p.until(() => !!p.document.querySelector('[data-connection="bridge"]'));
  assert.match(designerText(), /Connected with Bridge as ana/);
  for (const b of ['Open in Studio', 'Switch design system', 'Sign out']) assert.ok(buttons().includes(b), b);
  assert.equal(p.primary(), undefined, 'nothing to do: no primary action');
  assert.doesNotMatch(designerText(), /GitHub repository|token|owner\/name/i);

  // 3. Sign out: not connected, Sign in with Bridge again.
  await p.click('Sign out');
  await p.until(() => p.primary()?.textContent?.trim() === 'Sign in with Bridge' && !p.document.querySelector('[data-connection]'));
});
