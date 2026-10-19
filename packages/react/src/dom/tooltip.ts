// The React Tooltip for markup a script builds: put `tooltipAttributes(text)` on the trigger, call `bindTooltips()`
// once. Same popup classes as `<Tooltip>` (Tooltip.module.css), same behavior as Base UI Tooltip: opens on hover after
// a delay and on keyboard focus, neighbours open instantly after one closed, Escape and scroll close it, touch never
// opens it. While open, the popup is role="tooltip" and describes its trigger (aria-describedby), so a focusable
// Badge with a tip is read with it. Like the React one it stays a supplement: never put the only copy of
// essential information in a tooltip.
import styles from '../components/Tooltip/Tooltip.module.css';
import type { TooltipSide } from '../components/Tooltip';
import { attrs, type HtmlAttributes } from './html';

export interface TooltipAttributeOptions {
  /** Preferred side. Default `top`; it flips when there is no room. */
  side?: TooltipSide;
  /**
   * Make a non-interactive trigger (a Badge, a truncated label) reachable with Tab, so keyboard users get the tip.
   * Buttons and links are focusable already: leave it off for them.
   */
  focusable?: boolean;
}

/** The attributes that give an element a DS tooltip, as an object (for `attributes` options and `setAttribute`). */
export function tooltipAttributes(text: string, { side, focusable = false }: TooltipAttributeOptions = {}): HtmlAttributes {
  return { 'data-tooltip': text, 'data-tooltip-side': side && side !== 'top' ? side : undefined, tabindex: focusable ? 0 : undefined };
}

/** The same attributes as an HTML attribute string (with a leading space), to drop into a template. */
export function tooltipHtmlAttributes(text: string, options?: TooltipAttributeOptions): string {
  return attrs(tooltipAttributes(text, options));
}

export interface BindTooltipsOptions {
  /** Hover delay before the first tooltip opens, in ms. Default 500, the TooltipProvider default. */
  delay?: number;
}

const SIDE_OFFSET = 6;
const COLLISION_PADDING = 8;
/** After a tooltip closes, the next one within this window opens without delay (Base UI's group behavior). */
const INSTANT_WINDOW = 400;
const SCOPE_ATTRS = ['data-theme', 'data-brand', 'data-density'];

interface Bound {
  count: number;
  cleanup: () => void;
}
const BOUND = new WeakMap<Document | HTMLElement, Bound>();
let seq = 0;

/** Undoes what `show` put on a trigger: the open flag and the popup in aria-describedby. */
function unlink(el: HTMLElement, id: string) {
  el.removeAttribute('data-popup-open');
  const rest = (el.getAttribute('aria-describedby') ?? '').split(/\s+/).filter((t) => t && t !== id);
  if (rest.length) el.setAttribute('aria-describedby', rest.join(' '));
  else el.removeAttribute('aria-describedby');
}

/**
 * Wires every `[data-tooltip]` element inside `root` (present now or added later) with one delegated listener set.
 * Idempotent per root. Returns a function that removes the listeners and any open tooltip.
 */
export function bindTooltips(root: Document | HTMLElement = document, { delay = 500 }: BindTooltipsOptions = {}): () => void {
  const existing = BOUND.get(root);
  if (existing) {
    existing.count++;
    return () => release(root);
  }
  const doc = root instanceof Document ? root : root.ownerDocument;
  const win = doc.defaultView ?? window;
  let trigger: HTMLElement | null = null;
  let positioner: HTMLDivElement | null = null;
  let popup: HTMLDivElement | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastClosed = 0;

  const triggerOf = (t: EventTarget | null) => (t instanceof win.Element ? (t as Element).closest<HTMLElement>('[data-tooltip]') : null);

  const place = () => {
    if (!trigger || !positioner || !popup) return;
    const r = trigger.getBoundingClientRect();
    const vw = doc.documentElement.clientWidth;
    const vh = doc.documentElement.clientHeight;
    positioner.style.setProperty('--available-width', `${vw - COLLISION_PADDING * 2}px`);
    const p = popup.getBoundingClientRect();
    const want = (trigger.getAttribute('data-tooltip-side') as TooltipSide | null) ?? 'top';
    const room: Record<TooltipSide, boolean> = {
      top: r.top - p.height - SIDE_OFFSET >= COLLISION_PADDING,
      bottom: r.bottom + p.height + SIDE_OFFSET <= vh - COLLISION_PADDING,
      left: r.left - p.width - SIDE_OFFSET >= COLLISION_PADDING,
      right: r.right + p.width + SIDE_OFFSET <= vw - COLLISION_PADDING,
    };
    const flip: Record<TooltipSide, TooltipSide> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
    const side = room[want] || !room[flip[want]] ? want : flip[want];
    let x: number;
    let y: number;
    if (side === 'top' || side === 'bottom') {
      x = r.left + r.width / 2 - p.width / 2;
      y = side === 'top' ? r.top - SIDE_OFFSET - p.height : r.bottom + SIDE_OFFSET;
    } else {
      x = side === 'left' ? r.left - SIDE_OFFSET - p.width : r.right + SIDE_OFFSET;
      y = r.top + r.height / 2 - p.height / 2;
    }
    x = Math.min(Math.max(x, COLLISION_PADDING), vw - COLLISION_PADDING - p.width);
    y = Math.min(Math.max(y, COLLISION_PADDING), vh - COLLISION_PADDING - p.height);
    positioner.style.left = `${Math.round(x)}px`;
    positioner.style.top = `${Math.round(y)}px`;
    positioner.dataset.side = side;
    const origin: Record<TooltipSide, string> = { top: 'center bottom', bottom: 'center top', left: 'right center', right: 'left center' };
    positioner.style.setProperty('--transform-origin', origin[side]);
  };

  const remove = (el: HTMLElement | null) => el?.remove();

  const hide = () => {
    clearTimeout(timer);
    if (!positioner || !popup) {
      trigger = null;
      return;
    }
    const pos = positioner;
    const pop = popup;
    if (trigger) unlink(trigger, pop.id);
    trigger = null;
    positioner = null;
    popup = null;
    lastClosed = Date.now();
    pop.removeAttribute('data-open');
    pop.setAttribute('data-ending-style', '');
    pop.setAttribute('data-closed', '');
    const done = () => remove(pos);
    pop.addEventListener('transitionend', done, { once: true });
    setTimeout(done, 200);
  };

  const show = (el: HTMLElement, instant: boolean) => {
    const text = el.getAttribute('data-tooltip');
    if (!text) return;
    if (positioner) {
      // Moving between triggers: swap at once, like a TooltipProvider group.
      remove(positioner);
      if (trigger && popup) unlink(trigger, popup.id);
      positioner = null;
      popup = null;
      instant = true;
    }
    trigger = el;
    const pos = doc.createElement('div');
    pos.className = styles.positioner!;
    pos.style.position = 'fixed';
    pos.style.left = '0px';
    pos.style.top = '0px';
    pos.setAttribute('data-bridge-tooltip', '');
    const scope = el.closest('[data-theme]');
    if (scope && scope !== doc.documentElement) for (const a of SCOPE_ATTRS) if (scope.hasAttribute(a)) pos.setAttribute(a, scope.getAttribute(a)!);
    const pop = doc.createElement('div');
    pop.className = styles.tooltip!;
    pop.id = `bridge-tooltip-${++seq}`;
    pop.setAttribute('role', 'tooltip');
    pop.textContent = text;
    pop.setAttribute('data-open', '');
    if (instant) pop.setAttribute('data-instant', '');
    else pop.setAttribute('data-starting-style', '');
    pos.append(pop);
    doc.body.append(pos);
    positioner = pos;
    popup = pop;
    el.setAttribute('data-popup-open', '');
    el.setAttribute('aria-describedby', [el.getAttribute('aria-describedby'), pop.id].filter(Boolean).join(' '));
    place();
    if (!instant) win.requestAnimationFrame(() => win.requestAnimationFrame(() => pop.removeAttribute('data-starting-style')));
  };

  const schedule = (el: HTMLElement, wait: number) => {
    clearTimeout(timer);
    const instant = wait === 0 || Date.now() - lastClosed < INSTANT_WINDOW || Boolean(positioner);
    if (instant) show(el, true);
    else timer = setTimeout(() => show(el, false), wait);
  };

  const onOver = (e: Event) => {
    if ((e as PointerEvent).pointerType === 'touch') return;
    const el = triggerOf(e.target);
    if (!el || el === trigger) return;
    schedule(el, delay);
  };
  const onOut = (e: Event) => {
    const el = triggerOf(e.target);
    if (!el) return;
    const to = (e as PointerEvent).relatedTarget as Node | null;
    if (to && el.contains(to)) return;
    if (el === trigger || !positioner) hide();
    clearTimeout(timer);
  };
  const onFocusIn = (e: Event) => {
    const el = triggerOf(e.target);
    // Keyboard focus only: a click that focuses a button does not open a tooltip.
    if (el && el.matches(':focus-visible')) schedule(el, 0);
  };
  const onFocusOut = (e: Event) => {
    if (triggerOf(e.target) === trigger) hide();
  };
  const onKey = (e: Event) => {
    if ((e as KeyboardEvent).key === 'Escape' && positioner) hide();
  };
  const onPress = (e: Event) => {
    if (triggerOf(e.target) === trigger) hide();
  };
  const onScroll = () => {
    if (positioner) hide();
  };

  const target = root as unknown as EventTarget;
  target.addEventListener('pointerover', onOver);
  target.addEventListener('pointerout', onOut);
  target.addEventListener('focusin', onFocusIn);
  target.addEventListener('focusout', onFocusOut);
  target.addEventListener('pointerdown', onPress);
  doc.addEventListener('keydown', onKey);
  win.addEventListener('scroll', onScroll, true);
  const cleanup = () => {
    target.removeEventListener('pointerover', onOver);
    target.removeEventListener('pointerout', onOut);
    target.removeEventListener('focusin', onFocusIn);
    target.removeEventListener('focusout', onFocusOut);
    target.removeEventListener('pointerdown', onPress);
    doc.removeEventListener('keydown', onKey);
    win.removeEventListener('scroll', onScroll, true);
    clearTimeout(timer);
    remove(positioner);
    if (trigger && popup) unlink(trigger, popup.id);
  };
  BOUND.set(root, { count: 1, cleanup });
  return () => release(root);
}

function release(root: Document | HTMLElement) {
  const b = BOUND.get(root);
  if (!b) return;
  b.count--;
  if (b.count > 0) return;
  b.cleanup();
  BOUND.delete(root);
}
