// The search palette's field: a DS Input with the search icon before the value and the Esc hint after it, as a
// combobox over the results list (scripts/shell.ts drives the list, arrow keys and aria-activedescendant). A .tsx
// file because .astro markup cannot pass React elements as the Input's prefix and suffix. Rendered statically.
import { Icon, Input, Kbd } from '@bridge-ds/react';
import { Search } from 'lucide-react';

export default function PaletteField() {
  return (
    <Input
      id="palette-q"
      data-palette-q=""
      type="text"
      size="lg"
      aria-label="Search"
      placeholder="Search tokens, components, pages, or paste a hex"
      autoComplete="off"
      spellCheck={false}
      role="combobox"
      aria-expanded="true"
      aria-controls="palette-list"
      aria-autocomplete="list"
      prefix={<Icon icon={Search} size="sm" />}
      suffix={<Kbd keys="Esc" size="sm" />}
    />
  );
}
