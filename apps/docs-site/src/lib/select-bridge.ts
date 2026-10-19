// A DS Select on a page driven by a plain script (components/ds/BridgedSelect.tsx, a hydrated island): the island and
// the script talk through document events keyed by the select's id, the way StatusFilterSelect and ViewingSelect do.
// - A pick in the island: SELECT_PICK_EVENT { id, value } on document.
// - The script sets the value or the options: setSelect(id, { value, options }) remembers them on window (the island
//   may hydrate after the script ran) and sends SELECT_SET_EVENT; the island follows.
import type { ReactNode } from 'react';

export const SELECT_PICK_EVENT = 'bridge:select-pick';
export const SELECT_SET_EVENT = 'bridge:select-set';

/** One option as the script describes it. `count` shows as a Badge after the label (the Select badge slot). */
export interface BridgedOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
  group?: string;
  count?: number;
  badge?: ReactNode;
}

export interface SelectState {
  value?: string | null;
  options?: BridgedOption[];
}

export interface SelectPickDetail {
  id: string;
  value: string;
}

type Store = Record<string, SelectState>;
const STORE_KEY = '__bridgeSelects';

function store(): Store {
  const w = globalThis as unknown as Record<string, Store | undefined>;
  return (w[STORE_KEY] ??= {});
}

/** The last state a script set for this select (merged), or undefined. */
export const selectState = (id: string): SelectState | undefined => store()[id];

/** Merges a state into the remembered one: only the keys given change. Pure, exported for tests. */
export function mergeState(prev: SelectState | undefined, next: SelectState): SelectState {
  return { ...prev, ...Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined)) };
}

/** Sets the value and/or the options of a bridged Select from a plain script. */
export function setSelect(id: string, next: SelectState) {
  store()[id] = mergeState(store()[id], next);
  document.dispatchEvent(new CustomEvent<{ id: string } & SelectState>(SELECT_SET_EVENT, { detail: { id, ...next } }));
}

/** Calls `fn` with the new value each time the viewer picks an option in the bridged Select `id`. Returns an unsubscribe. */
export function onSelectPick(id: string, fn: (value: string) => void): () => void {
  const on = (e: Event) => {
    const d = (e as CustomEvent<SelectPickDetail>).detail;
    if (d?.id === id) {
      store()[id] = mergeState(store()[id], { value: d.value });
      fn(d.value);
    }
  };
  document.addEventListener(SELECT_PICK_EVENT, on);
  return () => document.removeEventListener(SELECT_PICK_EVENT, on);
}

/** The value of a bridged Select as the page knows it: the last pick or set, else `fallback`. */
export const selectValue = (id: string, fallback = ''): string => store()[id]?.value ?? fallback;
