// The homepage's behaviour (pages/index.astro), framework free; the pure parts are in lib/homepage.ts.
//   - Fixed-size drawings (the hero stage, the closing panorama) scaled to their column.
//   - Hero: drag the bridge (a native range input over the drawing). Release snaps to a side; left keeps the piece:
//     the "Kept" stamp, the caption, and a line that runs down from the handle. A hint sways the bridge until the
//     visitor touches it (never under reduced motion).
//   - Step tabs: click or arrows; the active step advances every 4.5 s while its section is on screen, and pauses on
//     hover or focus. Under reduced motion nothing advances on its own.
// Without this script the page is complete: the first step of each section shows, the hero rests in the middle.
import { fitScale, heroKeyTarget, heroSnap, heroValueText, panoramaFit, stepForKey, stepTick } from '../lib/homepage';

const $ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) => r.querySelector<T>(s);
const $$ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) => [...r.querySelectorAll<T>(s)];

export function initHomepage() {
  const rm = window.matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = rm.matches;
  rm.addEventListener('change', (e) => (reduced = e.matches));

  /* ---------- fit fixed drawings ---------- */
  const fits = $$('[data-fit]');
  const pano = $('[data-pano]');
  const panoStage = $('[data-pano-stage]');
  const fitAll = () => {
    for (const f of fits) f.style.setProperty('--hp-s', String(fitScale(f.clientWidth, Number(f.dataset.fit))));
    if (pano && panoStage) {
      const { x, scale, height } = panoramaFit(pano.clientWidth);
      panoStage.style.transform = `translate(${x}px, 40px) scale(${scale})`;
      pano.style.height = `${height}px`;
    }
  };

  /* ---------- hero ---------- */
  const hero = $('[data-hero]');
  const stage = $('[data-stage]');
  const rng = $<HTMLInputElement>('[data-range]');
  const kline = $('[data-kline]');
  const handle = stage?.querySelector<HTMLElement>('.hp-handle');
  let kept = false;
  const placeLine = () => {
    if (!hero || !handle || !kline) return;
    const hr = hero.getBoundingClientRect();
    const h = handle.getBoundingClientRect();
    if (!h.width) return;
    const top = h.bottom - hr.top;
    kline.style.left = `${h.left + h.width / 2 - hr.left}px`;
    kline.style.top = `${top}px`;
    kline.style.height = `${Math.max(80, hr.height - top + 36)}px`;
  };
  if (hero && stage && rng) {
    let touched = false;
    let dragging = false;
    let keptTimer = 0;
    if (!reduced) stage.classList.add('hp-hint');
    const touch = () => {
      if (touched) return;
      touched = true;
      stage.classList.remove('hp-hint');
    };
    const setX = (v: number, animate: boolean) => {
      stage.classList.toggle('hp-snap', animate && !reduced);
      stage.style.setProperty('--hp-x', `${v}%`);
      rng.value = String(v);
    };
    const setKept = (k: boolean) => {
      kept = k;
      stage.classList.toggle('hp-kept', k);
      hero.classList.toggle('hp-kept', k);
      rng.setAttribute('aria-valuetext', heroValueText(k ? 0 : Number(rng.value)));
      if (k) placeLine();
    };
    const snap = () => {
      const target = heroSnap(Number(rng.value));
      setX(target, true);
      clearTimeout(keptTimer);
      rng.setAttribute('aria-valuetext', heroValueText(target));
      if (target === 0) keptTimer = window.setTimeout(() => setKept(true), reduced ? 0 : 300);
      else setKept(false);
    };
    const release = () => {
      if (!dragging) return;
      dragging = false;
      stage.classList.remove('hp-drag');
      snap();
    };
    rng.addEventListener('pointerdown', () => {
      touch();
      dragging = true;
      stage.classList.add('hp-drag');
      clearTimeout(keptTimer);
    });
    rng.addEventListener('input', () => {
      touch();
      stage.classList.remove('hp-snap');
      stage.style.setProperty('--hp-x', `${rng.value}%`);
      if (kept && Number(rng.value) > 2) setKept(false);
      rng.setAttribute('aria-valuetext', heroValueText(Number(rng.value)));
    });
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    rng.addEventListener('change', () => !dragging && snap());
    rng.addEventListener('focus', touch);
    rng.addEventListener('keydown', (e) => {
      const t = heroKeyTarget(e.key);
      if (t === null) return;
      e.preventDefault();
      touch();
      rng.value = String(t);
      snap();
    });
  }

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
  const refit = () => {
    fitAll();
    if (kept) placeLine();
  };
  new ResizeObserver(refit).observe(document.documentElement);
  refit();
  document.fonts?.ready.then(refit);
}
