// "Viewing: Latest library" in the Studio top bar, on the pages that can show a change (Tokens, Components, Quality):
// one DS Select with the latest library and the open changes, each with its status. A hydrated island (client:load):
// scripts/view-change.ts reads the changes and sends the options (VIEW_OPTIONS_EVENT); a pick goes back as
// VIEW_PICK_EVENT and the script moves to the same page in that scope (lib/view-scope, ?change=N).
import { useEffect, useState } from 'react';
import { Select } from '@bridge-ds/react';
import { LATEST_LABEL, LATEST_VALUE, VIEW_OPTIONS_EVENT, VIEW_PICK_EVENT, VIEW_READY_EVENT, type ViewOption, type ViewOptionsDetail } from '../../../lib/view-scope';

export default function ViewingSelect() {
  // Rendered on the server as the latest library; the address decides once the script answers.
  const [state, setState] = useState<ViewOptionsDetail>({ options: [{ value: LATEST_VALUE, label: LATEST_LABEL, description: 'What is shipped' }], value: LATEST_VALUE });
  useEffect(() => {
    const on = (e: Event) => setState((e as CustomEvent<ViewOptionsDetail>).detail);
    document.addEventListener(VIEW_OPTIONS_EVENT, on);
    document.dispatchEvent(new CustomEvent(VIEW_READY_EVENT));
    return () => document.removeEventListener(VIEW_OPTIONS_EVENT, on);
  }, []);
  const options: ViewOption[] = state.options;
  return (
    <Select
      label="View the library as"
      hideLabel
      className="view-pick"
      prefix={<span className="view-pick-prefix">Viewing:</span>}
      options={options}
      value={state.value}
      title={state.note}
      onValueChange={(v) => {
        if (!v || v === state.value) return;
        setState((s) => ({ ...s, value: v }));
        document.dispatchEvent(new CustomEvent(VIEW_PICK_EVENT, { detail: v }));
      }}
    />
  );
}
