// Statically rendered DS Switch, Checkbox and RadioGroup (Astro, no hydration) for pages driven by plain scripts,
// the way static SegmentedControls opt in (scripts/shell.ts). Base UI renders the markup and its hidden native input;
// this file gives it behaviour. Opt in with `data-vanilla` on the component (it lands on the role element).
//
// - Switch (role switch): the page script owns the state. It listens to `click` on the switch and sets aria-checked;
//   here a click on the label reaches the switch, Space and Enter click it, and data-checked follows aria-checked
//   (the DS CSS paints from data-checked).
// - Checkbox and Radio: the hidden native input owns the state, as a native checkbox or radio would. A click or Space
//   (arrows in a radio group) sets input.checked and sends a bubbling `change` from the input, so form and filter
//   scripts keep reading `input[name]` and `checked`. A script that sets `checked` itself calls paintVanilla(root).

const SWITCH = '[data-vanilla][role="switch"]';
const BOX = '[data-vanilla][role="checkbox"]';
// Static SegmentedControls are radiogroups too; scripts/shell.ts drives them.
const GROUP = '[data-vanilla][role="radiogroup"]:not([data-segmented-control])';

const inputOf = (el: Element) => el.parentElement?.querySelector<HTMLInputElement>(':scope > input') ?? null;

function paintState(el: Element, on: boolean) {
  // Only on a change: the switch observer watches aria-checked, an equal write would wake it again.
  if (el.getAttribute('aria-checked') !== String(on)) el.setAttribute('aria-checked', String(on));
  for (const x of [el, ...el.querySelectorAll('[data-checked],[data-unchecked]')]) {
    x.toggleAttribute('data-checked', on);
    x.toggleAttribute('data-unchecked', !on);
  }
}

/** Paints static checkboxes and radios under `root` from their hidden inputs (after a script set `checked`). */
export function paintVanilla(root: ParentNode = document) {
  root.querySelectorAll(`${BOX}, ${GROUP} [role="radio"]`).forEach((el) => paintState(el, Boolean(inputOf(el)?.checked)));
  const groups = [...root.querySelectorAll(GROUP)];
  if (root instanceof Element && root.matches(GROUP)) groups.push(root);
  groups.forEach((g) => {
    const radios = [...g.querySelectorAll<HTMLElement>('[role="radio"]')];
    const on = radios.find((r) => r.getAttribute('aria-checked') === 'true') ?? radios[0];
    radios.forEach((r) => (r.tabIndex = r === on ? 0 : -1));
  });
}

function setChecked(control: HTMLElement, on: boolean) {
  const input = inputOf(control);
  if (!input || input.checked === on) return;
  input.checked = on;
  paintVanilla(control.closest(GROUP) ?? control.parentElement ?? document);
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

const controlIn = (target: EventTarget | null) => {
  const t = target instanceof Element ? target : null;
  if (!t) return null;
  const item = t.closest('[data-pseudo-root]');
  return t.closest<HTMLElement>(`${SWITCH}, ${BOX}, ${GROUP} [role="radio"]`) ?? item?.querySelector<HTMLElement>(`${SWITCH}, ${BOX}, ${GROUP} [role="radio"]`) ?? null;
};

const disabled = (el: Element) => el.hasAttribute('data-disabled') || el.getAttribute('aria-disabled') === 'true';

export function initVanillaControls() {
  paintVanilla();
  // data-checked follows aria-checked on static switches (their scripts set aria-checked).
  const sync = (el: Element) => paintState(el, el.getAttribute('aria-checked') === 'true');
  document.querySelectorAll(SWITCH).forEach(sync);
  new MutationObserver((list) => {
    for (const m of list) if (m.target instanceof Element && m.target.matches(SWITCH)) sync(m.target);
  }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['aria-checked'] });

  document.addEventListener(
    'click',
    (e) => {
      const control = controlIn(e.target);
      if (!control) return;
      // The DS wraps each control in a <label>: keep the browser from also clicking the hidden input.
      const fromLabel = !control.contains(e.target as Node);
      e.preventDefault();
      if (control.matches(SWITCH)) {
        // A click on the label text clicks the switch, where the page script listens.
        if (fromLabel && !disabled(control)) control.click();
        return;
      }
      if (disabled(control)) return;
      const radio = control.getAttribute('role') === 'radio';
      setChecked(control, radio ? true : !inputOf(control)?.checked);
      if (fromLabel) control.focus();
    },
    true,
  );

  document.addEventListener('keydown', (e) => {
    const control = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>(`${SWITCH}, ${BOX}, ${GROUP} [role="radio"]`) : null;
    if (!control || disabled(control)) return;
    if (e.key === ' ' || (e.key === 'Enter' && control.matches(SWITCH))) {
      e.preventDefault();
      if (control.matches(SWITCH)) control.click();
      else setChecked(control, control.getAttribute('role') === 'radio' ? true : !inputOf(control)?.checked);
      return;
    }
    if (control.getAttribute('role') !== 'radio') return;
    const radios = [...(control.closest(GROUP)?.querySelectorAll<HTMLElement>('[role="radio"]') ?? [])].filter((r) => !disabled(r));
    const step: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (!(e.key in step)) return;
    e.preventDefault();
    const next = radios[(radios.indexOf(control) + step[e.key]! + radios.length) % radios.length];
    if (!next) return;
    next.focus();
    setChecked(next, true);
  });
}
