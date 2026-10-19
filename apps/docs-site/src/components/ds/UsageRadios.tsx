// The Usage filter of the token explorer (Any, In use, Unused): a static DS RadioGroup (data-vanilla, behaviour in
// scripts/vanilla-controls.ts). scripts/explorer/index.ts reads and sets the hidden inputs named xp-usage.
import { Radio, RadioGroup } from '@bridge-ds/react';

export default function UsageRadios() {
  return (
    <RadioGroup label="Usage" name="xp-usage" defaultValue="" className="xp-usage" data-vanilla="">
      <Radio value="" label="Any" />
      <Radio value="used" label="In use" />
      <Radio value="unused" label="Unused" />
    </RadioGroup>
  );
}
