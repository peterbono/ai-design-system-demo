// The homepage's behaviour (pages/index.astro), framework free; the pure parts are in lib/homepage.ts.
//   - The closing panorama, a fixed-size drawing, scaled to its band. (The hero drawing is CSS only.)
//   - Step tabs: click or arrows; the active step advances every 4.5 s while its section is on screen, and pauses on
//     hover or focus. Under reduced motion nothing advances on its own.
// Without this script the page is complete: the first step of each section shows.
import { panoramaFit, stepForKey, stepTick } from '../lib/homepage';

const $ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) => r.querySelector<T>(s);
const $$ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) => [...r.querySelectorAll<T>(s)];

export function initHomepage() {
  const rm = window.matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = rm.matches;
  rm.addEventListener('change', (e) => (reduced = e.matches));

  /* ---------- fit the closing panorama ---------- */
  const pano = $('[data-pano]');
  const panoStage = $('[data-pano-stage]');
  const fitPano = () => {
    if (!pano || !panoStage) return;
    const { x, y, scale, height } = panoramaFit(pano.clientWidth);
    panoStage.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    pano.style.height = `${height}px`;
  };

  /* ---------- step tabs ---------- */
  const groups = $$('[data-steps]').map((sec) => {
    const g = {
      sec,
      tabs: $$<HTMLButtonElement>('[role=tab]', sec),
      items: $$('.hp-tabitem', sec),
      uis: $$('.hp-ui', sec),
      panel: $('[role=tabpanel]', sec)!,
      fills: $$('.hp-bar i', sec),
      i: 0,
      t: 0,
      inView: false,
      hover: false,
      focus: false,
    };
    g.tabs.forEach((tab, j) => {
      tab.addEventListener('click', () => go(g, j));
      tab.addEventListener('keydown', (e) => {
        const n = stepForKey(e.key, j, g.tabs.length);
        if (n === null) return;
        e.preventDefault();
        go(g, n);
        g.tabs[n]!.focus();
      });
    });
    sec.addEventListener('mouseenter', () => (g.hover = true));
    sec.addEventListener('mouseleave', () => (g.hover = false));
    sec.addEventListener('focusin', () => (g.focus = true));
    sec.addEventListener('focusout', (e) => (g.focus = Boolean(e.relatedTarget && sec.contains(e.relatedTarget as Node))));
    return g;
  });
  groups.forEach((g) => go(g, 0));
  type Group = (typeof groups)[number];
  function go(g: Group, j: number) {
    const changed = g.i !== j;
    g.i = j;
    g.t = 0;
    g.tabs.forEach((t, k) => {
      t.setAttribute('aria-selected', String(k === j));
      t.tabIndex = k === j ? 0 : -1;
    });
    g.items.forEach((it, k) => it.classList.toggle('hp-on', k === j));
    g.fills.forEach((f, k) => (f.style.transform = `scaleX(${reduced && k === j ? 1 : 0})`));
    g.panel.setAttribute('aria-labelledby', g.tabs[j]!.id);
    g.uis.forEach((u, k) => {
      if (k === j) return;
      u.classList.remove('hp-on');
      u.setAttribute('aria-hidden', 'true');
    });
    const u = g.uis[j]!;
    if (changed || !u.classList.contains('hp-on')) {
      // Restart the step's own animation.
      u.classList.remove('hp-on');
      void u.offsetWidth;
      u.classList.add('hp-on');
    }
    u.removeAttribute('aria-hidden');
  }
  const io = new IntersectionObserver(
    (es) => es.forEach((e) => groups.forEach((g) => g.sec === e.target && (g.inView = e.isIntersecting && e.intersectionRatio >= 0.4))),
    { threshold: [0, 0.2, 0.4, 0.6, 0.8, 1] },
  );
  groups.forEach((g) => io.observe(g.sec));
  let last = performance.now();
  const tick = (now: number) => {
    const dt = now - last;
    last = now;
    if (!reduced) {
      for (const g of groups) {
        const r = stepTick(g.t, dt, g.i, !g.inView || g.hover || g.focus, g.tabs.length);
        if (r.step !== g.i) go(g, r.step);
        else g.t = r.elapsed;
        const f = g.fills[g.i];
        if (f) f.style.transform = `scaleX(${Math.min(1, g.t / 4500).toFixed(4)})`;
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  /* ---------- init ---------- */
  new ResizeObserver(fitPano).observe(document.documentElement);
  fitPano();
  document.fonts?.ready.then(fitPano);
}
