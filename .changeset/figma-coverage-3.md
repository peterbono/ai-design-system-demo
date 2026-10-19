---
"@bridge-ds/core": minor
"@bridge-ds/figma-plugin": minor
"@bridge-ds/visual": minor
"@bridge-ds/docs-site": patch
---

Every visual component is in Figma: 47 of 47, 46 generated from code and 1 drafted with Claude. The generator now draws Checklist, Form, Slider, Table (and TableEmpty), Tabs and TokenValue from their code examples. New generator capabilities: CSS grid rows and subgrid rows as auto layout, `::before` / `::after` decorations as layers, Base UI indicators sized to the selected item (a tab underline) drawn in that item, unselected tab panels hidden, `data-orientation`, sliders (thumb at the value, value render functions), tables as rows of cells, form errors reaching their field, typed values in fields, functions as values, string and list methods, helpers that return elements, plain modules of the package, React's JSX text spacing, screen reader text left out of sentences, example texts shown by default, and absolute layers placed per variant. Side effects on sets already in Figma: Field and Dialog lose an empty error layer, NumberField steppers get their dividers, ChoiceCard text wraps, CodeBlock reads its wrap style.

Toast, shown from the `useToast` hook and never placed, is drafted with Claude: a spec written from the code in `packages/react/component-spec-overrides/Toast.json` (`"source": "drafted"`), validated against the format and the repo's tokens by `npm run specs`, counted as drafted (never as generated), marked "Drafted, check it" in the Pull preview and in its Figma description, and stale once its code changes. Specs record the code example they were drawn from, so the fidelity check renders the same content (rows, fields, tabs), and the Figma references capture renders hook-shown components (a toast) through their hook.
