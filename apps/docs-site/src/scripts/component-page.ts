// The page script of a Library component page (components/ds/library/views/ComponentView.tsx): Bridge's own static
// page starts it at load, a team's Library once the view is in the page. It drives the markup through data attributes:
//   - the hero's Light / Dark / Side by side switch (a DS SegmentedControl: static on Bridge's page, data-vanilla),
//   - the tabs (#usage, #tokens, #code, #changelog; old section anchors open the tab that holds them),
//   - the "On this page" rail of the open tab,
//   - the Storybook previews (data-sb-preview), which follow the preview brand and density (bridge:scope).
// And the Components page: a link to #fam-<family> opens that family even if it was collapsed.
import { COMPONENT_TABS, LEGACY_ANCHORS, previewUrl, storyInIndex } from '../lib/library/component-page';

/**
 * Checks that the published Storybook lists the story the previews play. When it does not (the code is ahead of the
 * last Storybook build), the previews would show Storybook's own error: the page shows the code example instead and
 * says the preview comes with the next Storybook update. An index that cannot be read leaves the previews as they are.
 */
export async function checkPreviewStory(doc: Document = document) {
  const page = doc.querySelector<HTMLElement>('[data-sb-check-story]');
  const base = page?.dataset.sbCheckBase;
  const story = page?.dataset.sbCheckStory;
  if (!page || !base || !story) return;
  try {
    const { loadStorybook } = await import('./storybook-source');
    const { index } = await loadStorybook(base);
    if (!storyInIndex(index.entries, story)) page.dataset.sbMissing = '';
  } catch {
    // Not readable from here (offline, a private Storybook): keep the previews.
  }
}

const started = new WeakSet<Document>();

/**
 * Points every Storybook preview at the preview brand and density the reader picked (kept on <html>; data-brands lists
 * the brands, the default first).
 */
export function syncPreviews(root: ParentNode = document) {
  const brands = (document.documentElement.dataset.brands ?? '').split(' ').filter(Boolean);
  const { previewBrand, previewDensity } = document.documentElement.dataset;
  for (const f of root.querySelectorAll<HTMLIFrameElement>('iframe[data-sb-preview]')) {
    const { sbBase, sbStory, sbTheme } = f.dataset;
    if (!sbBase || !sbStory || !sbTheme) continue;
    // The default brand and density stay out of the address: the story starts on them (and the page's first src holds).
    const brand = previewBrand && brands.length > 1 && previewBrand !== brands[0] ? previewBrand : undefined;
    const density = previewDensity && previewDensity !== 'comfortable' ? previewDensity : undefined;
    const src = previewUrl(sbBase, sbStory, { theme: sbTheme, brand, density });
    if (f.getAttribute('src') !== src) f.setAttribute('src', src);
  }
}

export function initComponentPage(doc: Document = document) {
  if (started.has(doc)) return;
  started.add(doc);
  void checkPreviewStory(doc);
  // The checked segment decides the view: shell.ts paints it on a static control, Base UI on a rendered one.
  doc.querySelectorAll<HTMLElement>('.hero-stage').forEach((stage) => {
    const control = stage.querySelector('[data-hero-view]');
    if (!control) return;
    const follow = () => {
      const value = control.querySelector<HTMLElement>('[data-segment][aria-checked="true"]')?.dataset.value;
      if (value) stage.dataset.view = value;
    };
    new MutationObserver(follow).observe(control, { subtree: true, attributes: true, attributeFilter: ['aria-checked'] });
  });

  const tablist = doc.querySelector<HTMLElement>('[data-cp-tabs]');
  const tabs = [...doc.querySelectorAll<HTMLAnchorElement>('[data-cp-tabs] [role="tab"]')];
  const panels = [...doc.querySelectorAll<HTMLElement>('[data-panel]')];
  const tocList = doc.querySelector<HTMLUListElement>('[data-cp-toc]');
  let io: IntersectionObserver | null = null;
  const paintToc = (panel: HTMLElement) => {
    if (!tocList) return;
    tocList.textContent = '';
    io?.disconnect();
    const heads = [...panel.querySelectorAll<HTMLElement>('h2[id]')];
    const links = heads.map((h) => {
      const li = doc.createElement('li');
      const a = doc.createElement('a');
      a.href = `#${h.id}`;
      a.textContent = h.textContent?.trim() ?? '';
      li.appendChild(a);
      tocList.appendChild(li);
      return a;
    });
    if (!('IntersectionObserver' in window) || !heads.length) return;
    io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          links.forEach((a) => (a.hash === `#${e.target.id}` ? a.setAttribute('aria-current', 'true') : a.removeAttribute('aria-current')));
        }
      },
      { rootMargin: '-15% 0px -75% 0px' },
    );
    heads.forEach((h) => io!.observe(h));
  };
  const select = (id: string, focus = false) => {
    const tab = tabs.find((t) => t.dataset.tab === id) ?? tabs[0];
    if (!tab) return;
    tabs.forEach((t) => {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
    });
    panels.forEach((p) => (p.hidden = p.dataset.panel !== tab.dataset.tab));
    const panel = panels.find((p) => p.dataset.panel === tab.dataset.tab);
    if (panel) paintToc(panel);
    if (focus) tab.focus();
  };
  const fromHash = () => {
    const h = decodeURIComponent(location.hash.slice(1));
    if (!h) return select(COMPONENT_TABS[0].id);
    if (tabs.some((t) => t.dataset.tab === h)) return select(h);
    const owner = LEGACY_ANCHORS[h] ?? doc.getElementById(h)?.closest<HTMLElement>('[data-panel]')?.dataset.panel;
    select(owner ?? COMPONENT_TABS[0].id);
    doc.getElementById(h)?.scrollIntoView();
  };
  tabs.forEach((t) =>
    t.addEventListener('click', (e) => {
      e.preventDefault();
      history.replaceState(history.state, '', `#${t.dataset.tab}`);
      select(t.dataset.tab!);
    }),
  );
  tablist?.addEventListener('keydown', (e) => {
    const i = tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true');
    const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    const t = tabs[(next + tabs.length) % tabs.length]!;
    history.replaceState(history.state, '', `#${t.dataset.tab}`);
    select(t.dataset.tab!, true);
  });
  if (tabs.length) {
    window.addEventListener('hashchange', fromHash);
    fromHash();
  }

  syncPreviews(doc);
  doc.addEventListener('bridge:scope', () => syncPreviews(doc));
}

/** The Components page: a link to #fam-forms opens that family even if it was collapsed. */
export function initComponentsIndex(doc: Document = document) {
  const open = () => {
    const el = location.hash ? doc.getElementById(decodeURIComponent(location.hash.slice(1))) : null;
    if (el instanceof HTMLDetailsElement) {
      el.open = true;
      el.scrollIntoView();
    }
  };
  window.addEventListener('hashchange', open);
  open();
}
