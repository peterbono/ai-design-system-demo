// A DS Select for pages driven by a plain script (a hydrated island, client:load). The page renders it with its
// options and first value; the script follows picks with onSelectPick(id) and moves it with setSelect(id), both in
// lib/select-bridge. With `name`, a hidden input carries the value in its form and announces each pick with a
// bubbling change event, so form scripts read it like the native select it replaces. An empty value ("All", "Not
// set") is a real option here: Base UI reads "" as no selection, so it travels inside the island as EMPTY.
import { useEffect, useRef, useState } from 'react';
import { Badge, Select, type SelectSize } from '@bridge-ds/react';
import { SELECT_PICK_EVENT, SELECT_SET_EVENT, selectState, type BridgedOption, type SelectPickDetail, type SelectState } from '../../lib/select-bridge';

export interface BridgedSelectProps {
  /** The key the script uses (setSelect, onSelectPick). */
  id: string;
  label: string;
  hideLabel?: boolean;
  hint?: string;
  options: BridgedOption[];
  value: string;
  size?: SelectSize;
  name?: string;
  className?: string;
  'aria-describedby'?: string;
}

const EMPTY = '\u0000empty';
const enc = (v: string) => (v === '' ? EMPTY : v);
const dec = (v: string | null) => (v == null || v === EMPTY ? '' : v);

const withBadges = (options: BridgedOption[]) =>
  options.map(({ count, badge, ...o }) => ({
    ...o,
    value: enc(o.value),
    badge:
      badge ??
      (count === undefined ? undefined : (
        <Badge size="sm" tone="neutral">
          {count}
        </Badge>
      )),
  }));

export default function BridgedSelect({ id, label, hideLabel, hint, options: initialOptions, value: initialValue, size = 'sm', name, className, ...aria }: BridgedSelectProps) {
  const [state, setState] = useState<Required<SelectState>>({ value: initialValue, options: initialOptions });
  const hidden = useRef<HTMLInputElement>(null);
  const picked = useRef(false);

  useEffect(() => {
    const remembered = selectState(id);
    if (remembered) setState((s) => ({ value: remembered.value ?? s.value, options: remembered.options ?? s.options }));
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ id: string } & SelectState>).detail;
      if (d?.id !== id) return;
      setState((s) => ({ value: d.value === undefined ? s.value : d.value, options: d.options ?? s.options }));
    };
    document.addEventListener(SELECT_SET_EVENT, on);
    return () => document.removeEventListener(SELECT_SET_EVENT, on);
  }, [id]);

  // After a pick has rendered, the hidden input holds the new value: tell form listeners.
  useEffect(() => {
    if (!picked.current) return;
    picked.current = false;
    hidden.current?.dispatchEvent(new Event('change', { bubbles: true }));
  }, [state.value]);

  return (
    <span className="bridged-select" data-bridged-select={id}>
      <Select
        label={label}
        hideLabel={hideLabel}
        hint={hint}
        size={size}
        className={className}
        options={withBadges(state.options)}
        value={enc(state.value ?? '')}
        onValueChange={(v) => {
          const next = dec(v);
          if (next === state.value) return;
          picked.current = true;
          setState((s) => ({ ...s, value: next }));
          document.dispatchEvent(new CustomEvent<SelectPickDetail>(SELECT_PICK_EVENT, { detail: { id, value: next } }));
        }}
        {...aria}
      />
      {name && <input ref={hidden} type="hidden" name={name} value={state.value ?? ''} />}
    </span>
  );
}
