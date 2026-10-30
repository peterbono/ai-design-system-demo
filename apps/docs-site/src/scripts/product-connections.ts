// Settings > Products: for each product with its own repository (bridge.config.json products[].repo), whether Bridge
// reaches it, with the viewer's session (one read of the repository each, core productRepoAccess). The only place the
// connection is said: Changes and the home leave an unreachable product out without a word. Rules and words:
// lib/settings-view.ts productConnectionRow.
import { productRepoAccess, type ProductConfig } from '@bridge-ds/core';
import { badgeHtml } from '@bridge-ds/react/dom';
import { installUrl } from '../lib/access-view';
import { askAdmin } from '../lib/create-branch';
import { productConnectionRow, type ProductConnection } from '../lib/settings-view';
import { esc, getToken, studioClient } from './github-session';
import { siteProductRepos } from './product-repos';

function rowHtml(product: ProductConfig, repo: string, state: ProductConnection): string {
  const row = productConnectionRow({ product: product.name, repo, state, installLink: installUrl() }, askAdmin);
  return `<div class="set-row" data-product-row="${esc(product.key)}">
    <p class="set-row-label">${esc(row.label)} ${badgeHtml(row.badge.text, { tone: row.badge.tone, size: 'sm' })}</p>
    <p class="set-row-value set-row-span">${esc(row.value)}${row.ask ? ` <button type="button" class="gh-inline-link" data-copy-ask="${esc(row.ask.message)}">${esc(row.ask.label)}</button>` : ''}</p>
  </div>`;
}

async function stateOf(repo: string): Promise<ProductConnection> {
  try {
    const a = await productRepoAccess(studioClient(repo, getToken() ?? ''));
    return a.ok ? 'connected' : a.reason;
  } catch {
    return 'unavailable';
  }
}

/** Paints the rows (checking first), then each one as its read lands. Hides the section when no product has its own repository. */
export function initProductConnections() {
  const host = document.querySelector<HTMLElement>('[data-product-connections]');
  const band = document.getElementById('products');
  if (!host) return;
  const repos = siteProductRepos();
  if (!repos.length) {
    if (band) band.hidden = true;
    return;
  }
  host.innerHTML = repos.map((x) => rowHtml(x.product, x.repo, 'checking')).join('');
  for (const x of repos) {
    void stateOf(x.repo).then((state) => {
      const el = host.querySelector(`[data-product-row="${CSS.escape(x.product.key)}"]`);
      if (el) el.outerHTML = rowHtml(x.product, x.repo, state);
    });
  }
  host.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-copy-ask]');
    if (!b || !navigator.clipboard) return;
    void navigator.clipboard.writeText(b.dataset.copyAsk ?? '').then(() => {
      b.textContent = 'Message copied. Paste it to an admin.';
    });
  });
}
