// The React Dialog for pages without React at runtime: `dialogHtml()` returns the markup `<DialogContent>` renders
// (same elements and Dialog.module.css classes, so the same look), `bindDialogs()` gives it the Base UI Dialog
// behavior: focus moves inside and stays there (Tab cycles, the rest of the page is inert), Escape and a click on the
// scrim close it, focus returns to what opened it, the page behind does not scroll. The popup is role="dialog" with
// aria-modal="true", named by its title and described by its description.
//
//   const html = dialogHtml({ id: 'new-token', title: 'New token', body: trusted(fields), footer: trusted(actions) });
//   bindDialogs(); // [data-dialog-open="new-token"] opens it, [data-dialog-close] closes it
//   openDialog('new-token'); closeDialog('new-token', 'saved');
//
// The root element fires `open` and `close` events (and a cancelable `cancel` before Escape, scrim or close button
// dismiss it), like a native <dialog>. A `<form method="dialog">` inside closes it on submit, with the submit button's
// value as the return value (`dialogReturnValue(el)`).
import styles from '../components/Dialog/Dialog.module.css';
import buttonStyles from '../components/Button/Button.module.css';
import iconButtonStyles from '../components/IconButton/IconButton.module.css';
import type { DialogSize } from '../components/Dialog';
import { attrs, classNames, content, escapeHtml, type HtmlAttributes, type TrustedHtml } from './html';
import { iconHtml } from './icons';

export interface DialogHtmlOptions {
  /** Id of the dialog root: `openDialog(id)` and `[data-dialog-open="id"]` triggers use it. Also prefixes the title and description ids. */
  id: string;
  /** Same as `<DialogContent title>`: the heading, and the accessible name. Escaped; pass `trusted()` for markup. */
  title: string | TrustedHtml;
  /** Same as `<DialogContent description>`: one or two sentences under the title, the accessible description. */
  description?: string | TrustedHtml;
  /** The body, already rendered and escaped (other renderers, server-rendered components): `trusted(html)`. */
  body?: TrustedHtml;
  /** The footer actions, usually a ButtonGroup with align="end": `trusted(html)`. */
  footer?: TrustedHtml;
  /** Same as `<DialogContent size>`. Default `md`. */
  size?: DialogSize;
  /** Same as `<DialogContent hideClose>`. */
  hideClose?: boolean;
  /** Same as `<DialogContent closeLabel>`. Default "Close dialog". */
  closeLabel?: string;
  /** Same as `<Dialog disablePointerDismissal>`: a click on the scrim does not close it (forms with unsaved input). */
  disablePointerDismissal?: boolean;
  /** Extra classes on the popup for layout, never to restyle the dialog. */
  className?: string;
  /** Extra attributes on the popup (the element with role="dialog"): `data-*` hooks, `aria-*`. */
  attributes?: HtmlAttributes;
}

/**
 * The exact markup of an open-able `<Dialog><DialogContent>` as an HTML string, hidden until `openDialog()`. Put it
 * anywhere in the page: it moves to the end of `<body>` when it opens, like the React portal.
 */
export function dialogHtml(options: DialogHtmlOptions): string {
  const { id, title, description, body, footer, size = 'md', hideClose = false, closeLabel = 'Close dialog', disablePointerDismissal = false, className } = options;
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  const popupAttrs = attrs({
    role: 'dialog',
    'aria-modal': 'true',
    tabindex: -1,
    class: classNames(styles.popup, styles[size], className),
    'aria-labelledby': titleId,
    'aria-describedby': description != null ? descriptionId : undefined,
    'data-dialog-popup': true,
    ...options.attributes,
  });
  const close = hideClose
    ? ''
    : `<button type="button" tabindex="0" aria-label="${escapeHtml(closeLabel)}" class="${classNames(buttonStyles.button, buttonStyles.ghost, buttonStyles.sm, buttonStyles.iconOnly, iconButtonStyles.iconButton, styles.close)}" data-dialog-close="">${iconHtml('x', 'sm')}</button>`;
  return (
    `<div id="${escapeHtml(id)}" data-bridge-dialog=""${disablePointerDismissal ? ' data-disable-pointer-dismissal=""' : ''} hidden="">` +
    `<div role="presentation" class="${styles.backdrop}" aria-hidden="true" data-dialog-backdrop=""></div>` +
    `<div role="presentation" class="${styles.viewport}" data-dialog-viewport="">` +
    `<div${popupAttrs}>` +
    `<div class="${classNames(styles.header, !hideClose && styles.withClose)}"><div class="${styles.heading}">` +
    `<h2 id="${escapeHtml(titleId)}" class="${styles.title}">${content(title)}</h2>` +
    (description != null ? `<p id="${escapeHtml(descriptionId)}" class="${styles.description}">${content(description)}</p>` : '') +
    `</div></div>` +
    (body != null ? `<div class="${styles.body}">${body.html}</div>` : '') +
    (footer != null ? `<div class="${styles.footer}">${footer.html}</div>` : '') +
    close +
    `</div></div></div>`
  );
}

type DialogTarget = string | HTMLElement;

export interface OpenDialogOptions {
  /** Where focus goes when the dialog closes. Default: the element that had focus when it opened. */
  returnFocus?: HTMLElement | null;
  /** Element to focus when it opens. Default: `[autofocus]`, else the first focusable element, else the popup. */
  initialFocus?: HTMLElement | null;
}

interface OpenState {
  root: HTMLElement;
  returnFocus: HTMLElement | null;
  inerted: HTMLElement[];
}

const FOCUSABLE = 'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), iframe, [contenteditable=""], [contenteditable="true"], [tabindex]:not([tabindex="-1"])';
const STACK: OpenState[] = [];
const BOUND = new WeakSet<Document>();
const TIMERS = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();
const RETURN_VALUE = new WeakMap<HTMLElement, string>();
let scrollLock: { overflow: string; gutter: string } | null = null;

const rootOf = (target: DialogTarget): HTMLElement | null => {
  const el = typeof target === 'string' ? document.getElementById(target) : target;
  return el?.closest<HTMLElement>('[data-bridge-dialog]') ?? null;
};
const part = (root: HTMLElement, name: 'backdrop' | 'viewport' | 'popup') => root.querySelector<HTMLElement>(`[data-dialog-${name}]`);
/** Rendered and reachable: not in a hidden or inert subtree, not display:none (where the browser can tell). */
const visible = (el: HTMLElement) => !el.closest('[hidden], [inert]') && (typeof el.checkVisibility !== 'function' || el.checkVisibility());
const focusables = (popup: HTMLElement) => [...popup.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(visible);

/** True while the dialog is open (or opening). */
export function isDialogOpen(target: DialogTarget): boolean {
  const root = rootOf(target);
  return Boolean(root && STACK.some((s) => s.root === root));
}

/** The value it was closed with: `closeDialog(el, value)` or the submit button of a `<form method="dialog">`. */
export function dialogReturnValue(target: DialogTarget): string {
  const root = rootOf(target);
  return (root && RETURN_VALUE.get(root)) ?? '';
}

function lockScroll(doc: Document) {
  if (scrollLock) return;
  const html = doc.documentElement;
  scrollLock = { overflow: html.style.overflow, gutter: html.style.scrollbarGutter };
  // Keep the scrollbar's room so the page does not shift under the scrim.
  if (html.scrollHeight > html.clientHeight) html.style.scrollbarGutter = 'stable';
  html.style.overflow = 'hidden';
}

function unlockScroll(doc: Document) {
  if (!scrollLock || STACK.length) return;
  doc.documentElement.style.overflow = scrollLock.overflow;
  doc.documentElement.style.scrollbarGutter = scrollLock.gutter;
  scrollLock = null;
}

/** Opens a dialog rendered by `dialogHtml()`: by its id or any element inside it. Binds the shared listeners. */
export function openDialog(target: DialogTarget, options: OpenDialogOptions = {}): void {
  const root = rootOf(target);
  if (!root || isDialogOpen(root)) return;
  const doc = root.ownerDocument;
  bindDialogs(doc);
  const popup = part(root, 'popup');
  const backdrop = part(root, 'backdrop');
  if (!popup) return;
  clearTimeout(TIMERS.get(root));
  RETURN_VALUE.delete(root);
  // Portal: last child of <body>, above the page, so everything else can be made inert.
  if (root.parentElement !== doc.body || root !== doc.body.lastElementChild) doc.body.append(root);
  const active = doc.activeElement instanceof HTMLElement && doc.activeElement !== doc.body ? doc.activeElement : null;
  const inerted = [...doc.body.children].filter((el): el is HTMLElement => el instanceof HTMLElement && el !== root && !el.inert && !(el instanceof HTMLScriptElement));
  for (const el of inerted) el.inert = true;
  root.inert = false;
  STACK.push({ root, returnFocus: options.returnFocus === undefined ? active : options.returnFocus, inerted });
  lockScroll(doc);
  root.hidden = false;
  for (const el of [backdrop, popup]) {
    el?.removeAttribute('data-ending-style');
    el?.removeAttribute('data-closed');
    el?.setAttribute('data-open', '');
    el?.setAttribute('data-starting-style', '');
  }
  part(root, 'viewport')?.setAttribute('data-open', '');
  const win = doc.defaultView ?? window;
  win.requestAnimationFrame(() => win.requestAnimationFrame(() => [backdrop, popup].forEach((el) => el?.removeAttribute('data-starting-style'))));
  const first =
    options.initialFocus ??
    popup.querySelector<HTMLElement>('[autofocus], [data-dialog-initial-focus]') ??
    focusables(popup).find((el) => !el.hasAttribute('data-dialog-close')) ??
    focusables(popup)[0] ??
    popup;
  first.focus();
  root.dispatchEvent(new Event('open'));
}

/** Closes a dialog, returns focus, and fires `close` on its root. `returnValue` is kept for `dialogReturnValue()`. */
export function closeDialog(target: DialogTarget, returnValue?: string): void {
  const root = rootOf(target);
  const i = STACK.findIndex((s) => s.root === root);
  if (!root || i < 0) return;
  const [state] = STACK.splice(i, 1);
  const doc = root.ownerDocument;
  if (returnValue !== undefined) RETURN_VALUE.set(root, returnValue);
  for (const el of state!.inerted) el.inert = false;
  // A dialog still open below this one keeps the page inert.
  const below = STACK[STACK.length - 1];
  if (below) for (const el of below.inerted) if (el !== root) el.inert = true;
  unlockScroll(doc);
  const backdrop = part(root, 'backdrop');
  const popup = part(root, 'popup');
  part(root, 'viewport')?.removeAttribute('data-open');
  for (const el of [backdrop, popup]) {
    el?.removeAttribute('data-open');
    el?.removeAttribute('data-starting-style');
    el?.setAttribute('data-ending-style', '');
    el?.setAttribute('data-closed', '');
  }
  const done = () => {
    clearTimeout(TIMERS.get(root));
    if (isDialogOpen(root)) return;
    root.hidden = true;
    backdrop?.removeAttribute('data-ending-style');
    popup?.removeAttribute('data-ending-style');
  };
  popup?.addEventListener('transitionend', done, { once: true });
  TIMERS.set(root, setTimeout(done, 250));
  const back = state!.returnFocus;
  if (back && back.isConnected && visible(back)) back.focus();
  root.dispatchEvent(new Event('close'));
}

/** Escape, scrim and close button: a cancelable `cancel` event first, then close. */
function dismiss(root: HTMLElement) {
  if (!root.dispatchEvent(new Event('cancel', { cancelable: true }))) return;
  closeDialog(root, '');
}

/**
 * Wires every dialog rendered by `dialogHtml()` in `doc`, present now or added later: `[data-dialog-open="id"]`
 * triggers, `[data-dialog-close]` buttons (their `value` is the return value), `<form method="dialog">` submits,
 * Escape, scrim clicks and the Tab focus trap. Idempotent; `openDialog()` calls it for you.
 */
export function bindDialogs(doc: Document = document): void {
  if (BOUND.has(doc)) return;
  BOUND.add(doc);
  const top = () => STACK[STACK.length - 1];

  doc.addEventListener('click', (e) => {
    const t = e.target instanceof Element ? e.target : null;
    if (!t) return;
    const opener = t.closest<HTMLElement>('[data-dialog-open]');
    if (opener) {
      e.preventDefault();
      openDialog(opener.getAttribute('data-dialog-open')!, { returnFocus: opener });
      return;
    }
    const closer = t.closest<HTMLElement>('[data-dialog-close]');
    const root = closer?.closest<HTMLElement>('[data-bridge-dialog]');
    if (closer && root) {
      // With a value it is an answer (closes with that return value); without, a dismiss like Escape.
      const value = closer.getAttribute('value');
      if (value) closeDialog(root, value);
      else dismiss(root);
      return;
    }
    // A click on the viewport itself is a click on the scrim (the popup is its only child).
    const state = top();
    if (state && t.matches('[data-dialog-viewport]') && t.closest('[data-bridge-dialog]') === state.root && !state.root.hasAttribute('data-disable-pointer-dismissal')) dismiss(state.root);
  });

  doc.addEventListener('submit', (e) => {
    const form = e.target instanceof HTMLFormElement ? e.target : null;
    const root = form?.closest<HTMLElement>('[data-bridge-dialog]');
    if (!form || !root || form.getAttribute('method')?.toLowerCase() !== 'dialog') return;
    // Like a native dialog: closes without navigating. A submit listener on the form that calls preventDefault
    // (validation failed, async save) keeps it open; the document listener runs after the form's own.
    if (e.defaultPrevented) return;
    const submitter = (e as SubmitEvent).submitter as HTMLButtonElement | null;
    closeDialog(root, submitter?.value ?? '');
  });

  doc.addEventListener('keydown', (e) => {
    const state = top();
    if (!state) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      dismiss(state.root);
      return;
    }
    if (e.key !== 'Tab') return;
    const popup = part(state.root, 'popup');
    if (!popup) return;
    const items = focusables(popup);
    if (!items.length) {
      e.preventDefault();
      popup.focus();
      return;
    }
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const current = doc.activeElement;
    if (e.shiftKey && (current === first || current === popup || !popup.contains(current))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (current === last || !popup.contains(current))) {
      e.preventDefault();
      first.focus();
    }
  });

  // Focus that escapes anyway (a script focusing the page) comes back to the dialog.
  doc.addEventListener('focusin', (e) => {
    const state = top();
    const popup = state && part(state.root, 'popup');
    if (popup && e.target instanceof Node && !state.root.contains(e.target)) (focusables(popup)[0] ?? popup).focus();
  });
}
