// The landing's behaviour (pages/index.astro, pages/compare.astro), small and framework free:
//   - the theme toggle (same memory as the app: localStorage ds-theme);
//   - copy on the DS CodeBlocks (the install line);
//   - the journey line: one strand from each hero card joins at the "linked" chip, then one line runs through the
//     three stations to the design system. It draws itself with scroll, an "Overdue tone" marker rides its tip, the part
//     ahead stays dotted; the mini-map follows the station you are at. Progressive enhancement: without this script,
//     or under reduced motion, the page is complete (reduced motion draws the whole line at rest, no marker).
// Geometry is pure in lib/landing.ts.
import { bindCodeBlocks } from '@bridge-ds/react/dom';
import { currentStation, drawnLength, journeyPath, type Point } from '../lib/landing';

function initTheme() {
  const root = document.documentElement;
  const btns = [...document.querySelectorAll<HTMLButtonElement>('[data-theme-toggle]')];
  const sync = () => btns.forEach((b) => b.setAttribute('aria-pressed', String(root.getAttribute('data-theme') === 'dark')));
  sync();
  for (const btn of btns) {
    btn.addEventListener('click', () => {
      const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try {
        localStorage.setItem('ds-theme', next);
      } catch {
        /* private mode: the theme still applies to this page */
      }
      sync();
    });
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function initJourney() {
  const journey = document.querySelector<HTMLElement>('[data-journey]');
  const svg = journey?.querySelector<SVGSVGElement>('[data-line]');
  const done = journey?.querySelector<SVGPathElement>('[data-line-done]');
  const ahead = journey?.querySelector<SVGPathElement>('[data-line-ahead]');
  if (!journey || !svg || !done || !ahead) return;
  const marker = journey.querySelector<HTMLElement>('[data-marker]');
  const end = journey.querySelector<HTMLElement>('[data-end]');
  const steps = [...document.querySelectorAll<HTMLElement>('[data-map-step]')];
  const stations = [...journey.querySelectorAll<HTMLElement>('[data-station]')];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const strands: SVGPathElement[] = [];
  let total = 0;

  const at = (el: Element | null, where: 'center' | 'bottom' | 'top'): Point | null => {
    if (!el) return null;
    const box = journey.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return null;
    const y = where === 'bottom' ? r.bottom : where === 'top' ? r.top : r.top + r.height / 2;
    return { x: r.left + r.width / 2 - box.left, y: y - box.top };
  };

  const layout = () => {
    const box = journey.getBoundingClientRect();
    svg.setAttribute('width', String(Math.round(box.width)));
    svg.setAttribute('height', String(Math.round(box.height)));
    svg.setAttribute('viewBox', `0 0 ${Math.round(box.width)} ${Math.round(box.height)}`);
    const a = at(journey.querySelector('[data-anchor="a"]'), 'bottom');
    const b = at(journey.querySelector('[data-anchor="b"]'), 'bottom');
    const join = at(journey.querySelector('[data-anchor="join"]'), 'center');
    const nodes = [...journey.querySelectorAll('[data-anchor="node"]')].map((n) => at(n, 'center')).filter((p): p is Point => Boolean(p));
    const last = at(journey.querySelector('[data-anchor="end"]'), 'top');
    // The two strands only when the hero cards sit side by side (wide screens); stacked, the line starts at the chip.
    const sideBySide = a && b && join && Math.abs(a.y - b.y) < 40 && a.y < join.y;
    const legs = sideBySide ? [journeyPath([a, join]), journeyPath([b, join])] : [];
    while (strands.length < legs.length) {
      const p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('class', 'lp-line-done');
      svg.insertBefore(p, done);
      strands.push(p);
    }
    strands.forEach((p, i) => p.setAttribute('d', legs[i] ?? ''));
    const main = [join, ...nodes, last].filter((p): p is Point => Boolean(p));
    const d = journeyPath(main);
    done.setAttribute('d', d);
    ahead.setAttribute('d', d);
    total = d ? done.getTotalLength() : 0;
    done.style.strokeDasharray = `${total} ${total}`;
    paint();
  };

  let frame = 0;
  const paint = () => {
    frame = 0;
    const box = journey.getBoundingClientRect();
    const line = window.innerHeight * 0.6 - box.top;
    const len = reduced.matches ? total : drawnLength(total, line, (l) => done.getPointAtLength(l));
    done.style.strokeDashoffset = String(total - len);
    if (marker) {
      const show = !reduced.matches && len > 0 && len < total;
      marker.hidden = !show;
      if (show) {
        const p = done.getPointAtLength(len);
        marker.style.transform = `translate(calc(${Math.round(p.x)}px - 50%), calc(${Math.round(p.y)}px - 50%))`;
      }
    }
    end?.toggleAttribute('data-reached', total > 0 && len >= total - 2);
    // The mini-map: dots fill as you pass, the station you are at is the current step.
    const tops = stations.map((s) => s.getBoundingClientRect().top);
    const now = currentStation(tops, window.innerHeight * 0.6);
    steps.forEach((li, i) => {
      li.dataset.state = i < now ? 'done' : i === now ? 'current' : 'ahead';
      const link = li.querySelector('a');
      if (i === now) link?.setAttribute('aria-current', 'step');
      else link?.removeAttribute('aria-current');
    });
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(paint);
  };

  layout();
  journey.setAttribute('data-drawn', '');
  window.addEventListener('scroll', schedule, { passive: true });
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => layout()).observe(journey);
  else window.addEventListener('resize', layout, { passive: true });
  reduced.addEventListener('change', paint);
  // Web fonts change line breaks, so the anchors move once they load.
  void document.fonts?.ready.then(layout);
}

export function initLanding() {
  initTheme();
  bindCodeBlocks();
  initJourney();
}
