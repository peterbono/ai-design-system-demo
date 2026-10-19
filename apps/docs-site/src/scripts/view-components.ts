// Studio Components showing the library as an open change (lib/view-scope, ?change=N): the thumbnails and the drawer
// previews paint with the change's tokens (the CSS variables whose value differs, per theme), the components that
// look different and those whose guidance the change edits are marked (Looks different, Guidance edited), and the
// banner says both in one sentence. The list, its guidance text and its counts stay the latest library's: it says so.
import { buildTokenSet, layoutOptions, loadConfig } from '@bridge-ds/core';
import { previewOverrides } from '../lib/editor-model';
import { bannerBody, changedComponents, changedGuidance, GUIDANCE_LABEL, isTogether, LOOKS_LABEL, overrideCss } from '../lib/view-scope';
import { currentPull, pageScope, readFailure, scopeLibrary, setBannerBody, setBannerError } from './view-change';

interface LibraryFiles {
  tokensRoot: string;
  componentsDir: string;
  config: string;
  files: Record<string, string>;
  components: Record<string, { name: string; paths: string[] }>;
  docs: Record<string, { name: string; path: string; sha: string }>;
}

export async function initViewOnComponents(root: HTMLElement) {
  if (pageScope().kind !== 'view') return;
  const pull = currentPull();
  if (!pull) return;
  root.dataset.view = 'loading';
  try {
    const [, latest] = await Promise.all([
      pull,
      fetch('/studio/library-files.json').then((r) => {
        if (!r.ok) throw new Error('The latest library could not be read.');
        return r.json() as Promise<LibraryFiles>;
      }),
    ]);
    const config = loadConfig(latest.config);
    const lib = await scopeLibrary(latest.files, latest.tokensRoot, [latest.componentsDir]);
    const opts = layoutOptions(config);
    const main = buildTokenSet(latest.files, opts);
    const head = buildTokenSet(lib.files, opts);
    const html = document.documentElement;
    const ctx = (theme: string) => ({ theme, brand: html.dataset.previewBrand ?? config.modes.defaults.brand ?? 'bridge', density: html.dataset.previewDensity ?? config.modes.defaults.density ?? 'comfortable' });
    const byTheme = Object.fromEntries(config.modes.themes.map((t) => [t, previewOverrides(main, head, ctx(t))]));
    const style = document.createElement('style');
    style.dataset.viewStyle = '';
    // Thumbnails follow the page theme; drawer previews carry their own (the Light/Dark switch).
    style.textContent = overrideCss(byTheme, (t) => `html[data-theme="${t}"] .cm-thumb, .cm-d-frame[data-theme="${t}"]`);
    document.head.append(style);

    const vars = new Set(Object.values(byTheme).flatMap((v) => Object.keys(v)));
    const looks = changedComponents(latest.components, vars);
    // Changes shown together are token changes only, and have no tree to compare guidance with.
    const guidance = lib.extra ? changedGuidance(latest.docs, lib.extra) : [];
    const mark = (slug: string, label: string) => {
      const body = root.querySelector(`[data-cm-row="${CSS.escape(slug)}"] .cm-name-body`);
      if (!body) return;
      const pill = document.createElement('span');
      pill.className = 'pill cm-pill cm-pill-change';
      pill.textContent = label;
      body.append(pill);
    };
    looks.forEach((s) => mark(s, LOOKS_LABEL));
    guidance.forEach((s) => mark(s, GUIDANCE_LABEL));
    setBannerBody(bannerBody('components', { components: looks.length, guidance: guidance.map((s) => latest.docs[s]?.name ?? s), together: isTogether(pageScope()) }));
    root.dataset.view = 'ready';
  } catch (err) {
    root.dataset.view = 'error';
    setBannerError(readFailure(err, isTogether(pageScope()) ? 'These changes' : 'This change'));
  }
}
