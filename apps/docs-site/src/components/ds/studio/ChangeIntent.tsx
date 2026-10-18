// "Change this component" in the Studio Components drawer, first step: what the designer wants to change, as one DS
// RadioGroup in place in the drawer (no dialog on top of it). The page script (scripts/request-form.ts) says which
// component is open and whether it has tokens (`bridge:change-intent-set`); a pick is sent back as
// `bridge:change-intent`, and the script shows the flow that follows under the choice. Words: lib/change-intent.ts.
import { useEffect, useState } from 'react';
import { Radio, RadioGroup } from '@bridge-ds/react';
import { intentOptions, isChangeIntent, type ChangeIntent as Intent } from '../../../lib/change-intent';

export const INTENT_EVENT = 'bridge:change-intent';
export const INTENT_SET_EVENT = 'bridge:change-intent-set';

export interface IntentSetDetail {
  /** The intent to show as picked, or null for none (a freshly opened step). */
  value: Intent | null;
  hasTokens: boolean;
}

export default function ChangeIntent() {
  const [value, setValue] = useState<Intent | null>(null);
  const [hasTokens, setHasTokens] = useState(true);

  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<IntentSetDetail>).detail;
      setValue(d.value);
      setHasTokens(d.hasTokens);
    };
    document.addEventListener(INTENT_SET_EVENT, on);
    // The script may have opened a drawer before this island hydrated: start from what the drawer says.
    const drawer = document.querySelector<HTMLElement>('[data-cm-drawer]');
    if (drawer?.dataset.hasTokens) setHasTokens(drawer.dataset.hasTokens === 'true');
    return () => document.removeEventListener(INTENT_SET_EVENT, on);
  }, []);

  return (
    <RadioGroup
      label="What do you want to change?"
      name="change-intent"
      value={value ?? ''}
      onValueChange={(v) => {
        if (!isChangeIntent(v)) return;
        setValue(v);
        document.dispatchEvent(new CustomEvent(INTENT_EVENT, { detail: { value: v } }));
      }}
    >
      {intentOptions(hasTokens).map((o) => (
        <Radio key={o.value} value={o.value} label={o.label} description={o.line} disabled={o.disabled} />
      ))}
    </RadioGroup>
  );
}
