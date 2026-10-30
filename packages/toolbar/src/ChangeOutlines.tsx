// The outlines of "Show what changed": one dashed Deep Harbor frame per changed surface (the outermost changed
// element), with a role chip in its corner, in a fixed layer above the page that takes no pointer events, no focus
// and no layout. A page-sized surface gets an inset frame so it never reads as browser chrome. Only surfaces with a
// visible, non-zero box in the viewport are drawn, and only those are counted (onShown). Isolate adds a scrim over the
// rest of the page with a cut-out around each changed surface (page-sized ones excepted: they would leave no scrim).
import { useEffect, useId, useLayoutEffect, useState, type ReactNode } from 'react';
import { ThemeProvider, Tooltip } from '@bridge-ds/react';
import type { Theme } from '@bridge-ds/react';
import { shownRect, type ChangedElement } from './outline';
import type { Rect } from './session';
import { PIN_ATTR, PIN_CLASS } from './pin';
import styles from './BridgeToolbar.module.css';

/** Inset of a page-sized frame, so it sits inside the viewport like a selection, not like the window edge. */
const INSET = 8;
/** Room around a surface in the Isolate scrim, so its dashed frame stays in the light too. */
const HOLE = 4;

export interface Shown {
  /** Visible surfaces, in order. */
  count: number;
  /** Boxes of the visible surfaces that are not page-sized: the toolbar keeps clear of them. */
  obstacles: Rect[];
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
  radius: string;
  page: boolean;
}

function boxOf(el: Element): Box | null {
  const r = shownRect(el);
  if (!r) return null;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const left = Math.max(r.left, 0);
  const top = Math.max(r.top, 0);
  const right = Math.min(r.right, vw);
  const bottom = Math.min(r.bottom, vh);
  // Page-sized: covers most of the viewport. Drawn as an inset frame with its chip top left.
  const page = (right - left) * (bottom - top) > 0.85 * vw * vh;
  if (page) return { left: INSET, top: INSET, width: vw - 2 * INSET, height: vh - 2 * INSET, radius: '', page };
  return { left, top, width: right - left, height: bottom - top, radius: getComputedStyle(el).borderRadius, page };
}

export function ChangeOutlines({
  surfaces,
  theme,
  tip,
  onShown,
  emphasis,
  flash,
  isolate = false,
}: {
  surfaces: ChangedElement[];
  theme: Theme;
  /** The surface whose list row is hovered, focused or activated: chip and stronger outline. */
  emphasis: number | null;
  /** Show every chip (the moment outlines turn on). */
  flash: boolean;
  /** Dim everything but the changed surfaces. */
  isolate?: boolean;
  /** Tooltip content for a surface: its role, token and before and after. */
  tip: (s: ChangedElement) => ReactNode;
  onShown: (shown: Shown) => void;
}) {
  const [tick, setTick] = useState(0);
  const [active, setActive] = useState<number | null>(null);
  const maskId = `bridge-isolate-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  // Follow the page: re-measure on scroll and resize, one frame at a time.
  useEffect(() => {
    let frame = 0;
    const on = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setTick((t) => t + 1));
    };
    window.addEventListener('scroll', on, { passive: true, capture: true });
    window.addEventListener('resize', on);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', on, { capture: true });
      window.removeEventListener('resize', on);
    };
  }, []);

  const boxes = surfaces.map((s) => boxOf(s.el));

  // Count only what is drawn; hand the toolbar the boxes to keep clear of.
  const shownKey = boxes.map((b) => (b ? `${Math.round(b.left)},${Math.round(b.top)},${Math.round(b.width)},${Math.round(b.height)}` : '-')).join('|');
  useLayoutEffect(() => {
    onShown({
      count: boxes.filter(Boolean).length,
      obstacles: boxes.filter((b): b is Box => Boolean(b && !b.page)).map((b) => ({ left: b.left, top: b.top, right: b.left + b.width, bottom: b.top + b.height })),
    });
  }, [shownKey, tick]);

  // The smallest visible surface under the pointer (page-sized ones would answer every move), or around the focus.
  useEffect(() => {
    const pick = (match: (el: Element, i: number) => boolean) => {
      let best: number | null = null;
      let area = Infinity;
      surfaces.forEach((s, i) => {
        const b = boxOf(s.el);
        if (!b || b.page || !match(s.el, i)) return;
        if (b.width * b.height < area) {
          area = b.width * b.height;
          best = i;
        }
      });
      return best;
    };
    const move = (e: PointerEvent) =>
      setActive(
        pick((el) => {
          const r = el.getBoundingClientRect();
          return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
        }),
      );
    const focus = (e: FocusEvent) => setActive(e.target instanceof Node ? pick((el) => el.contains(e.target as Node)) : null);
    document.addEventListener('pointermove', move, { passive: true });
    document.addEventListener('focusin', focus);
    return () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('focusin', focus);
    };
  }, [surfaces]);

  return (
    <ThemeProvider theme={theme} brand="bridge" density="compact" className={styles.overlay} data-bridge-overlay="" data-isolate={isolate || undefined} {...{ [PIN_ATTR]: '' }} aria-hidden="true">
      {isolate ? (
        <svg className={styles.scrim} width="100%" height="100%" focusable="false">
          <defs>
            <mask id={maskId}>
              <rect width="100%" height="100%" fill="white" />
              {boxes.map((b, i) =>
                b && !b.page ? (
                  <rect key={i} x={b.left - HOLE} y={b.top - HOLE} width={b.width + 2 * HOLE} height={b.height + 2 * HOLE} rx={(parseFloat(b.radius) || 0) + HOLE} fill="black" />
                ) : null,
              )}
            </mask>
          </defs>
          <rect className={styles.scrimFill} width="100%" height="100%" mask={`url(#${maskId})`} />
        </svg>
      ) : null}
      {boxes.map((b, i) => {
        if (!b) return null;
        const s = surfaces[i]!;
        // Chips are hidden by default: shown on hover of the surface, on its list row, and briefly when outlines turn on.
        const showChip = flash || active === i || emphasis === i;
        const chip = (
          <span className={styles.chip} data-page={b.page || undefined} data-shown={showChip || undefined}>
            {s.label}
          </span>
        );
        return (
          <span
            key={i}
            className={styles.box}
            data-page={b.page || undefined}
            data-inside={(!b.page && b.top < 24) || undefined}
            data-emphasis={emphasis === i || undefined}
            style={{ left: b.left, top: b.top, width: b.width, height: b.height, borderRadius: b.radius }}
          >
            <span className={styles.tint} />
            {active === i || emphasis === i ? (
              // Above the chip when there is room, else below it: never over the toolbar, which keeps clear of boxes.
              <Tooltip open content={tip(s)} side={b.top < 64 ? 'bottom' : 'top'} align="start" className={PIN_CLASS}>
                {chip}
              </Tooltip>
            ) : (
              chip
            )}
          </span>
        );
      })}
    </ThemeProvider>
  );
}
