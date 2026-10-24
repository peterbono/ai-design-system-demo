# Figma fixes and gap cases

How Bridge keeps its Figma pull true for any design system. The general measure (`bridge specs --measure`) draws most
components right. For the rest, the team's own Claude writes a correction, Bridge re-checks it against the story's
screenshot, and a person approves it. A component that will not converge keeps an honest status (Differs, or Can't
check with the reason). Code: `packages/core/src/gap-case.ts` and `packages/core/src/figma-fixes.ts` (pure, browser
safe), `packages/cli/src/fixes.ts` (the commands).

```
pull -> Check fidelity (story shot vs Figma render, per variant)
     -> gap case per differing component (bridge gap)
     -> Claude proposes a fix (figma-fixes.json, in a pull request)
     -> pull again with the fix, Check fidelity again
     -> a person approves the pull request
```

**The shot decides.** The story's screenshot is the referee. A gap case explains a difference the shot comparison
found; a fix is kept only when the next Check fidelity shows the variant closer to its shot. Nothing in this loop can
mark a component as matching: a fix of kind `status` can say Differs or Can't check, never Matches.

## Gap case

`bridge gap <component>` (or `buildGapCase` in the plugin) builds one component's gap case from:

- `measured-specs.json`: what each story renders (with `figma-fixes.json` already applied);
- the plugin's Check fidelity result: which variants differ, by how many pixels, and both sizes;
- the component spec the pull drew the set from, and optionally what the plugin reads back from the layers (values,
  hidden parts, boxes);
- the story shots (`measured-shots/manifest.json`).

For each variant that differs it gives the story (id, props, args Bridge passed, state), the shot, the Figma render
when the plugin passes one, and the differences. `expected` is always the code (the measure), `actual` is Figma:

| Property | Example text |
| --- | --- |
| `height`, `width` (root) | Height 72 in Figma vs 84 in code: 8 px missing below the label, 4 px missing below the text input field wrapper |
| `presence` | The toggle switch before is missing in Figma / is hidden in Figma, shown in code / is in Figma, not in the code render |
| `sizing` | Width fixed at 48 in code, hugs its content in Figma (btn) |
| `direction` | Children side by side in Figma, stacked in code (appearance) |
| any field | Corner radius 0 in Figma vs full in code (toggle switch) |

Where the space goes needs the layer boxes (`built[variant].boxes`); without them the gap gives the size only. A
variant whose shot differs while every measured value agrees says so ("compare the shot with the Figma render"), and a
variant no story renders says how to fix that (measure it, or a `story` fix).

The case carries `summary` (one sentence for a designer) and `detail` (lines for a developer or Claude), plus
`differences[]` with `part`, `property`, `expected`, `actual` and `delta` (px) for a fix to be written from.

## figma-fixes.json

A versioned file at the repo root, next to `bridge.config.json` and `measured-specs.json`. Every pull applies it to a
fresh measure, so fixes survive pulls. Commands:

```sh
bridge fixes check [--in measured-specs.json]          # validate; with --in, list fixes that find nothing
bridge fixes apply --in measured-specs.json --out measured-specs.fixed.json
bridge gap Toggle --fidelity fidelity.json --specs specs.json
```

```json
{
  "version": 1,
  "fixes": [
    {
      "id": "toggle-switch-pill",
      "kind": "part",
      "component": "Toggle",
      "part": ".cds--toggle__switch",
      "set": { "cornerRadius": "full" },
      "reason": "Carbon toggles are pills in every size; Figma drew square corners.",
      "by": "claude"
    }
  ]
}
```

Every fix has:

| Key | Required | What |
| --- | --- | --- |
| `id` | yes | Lower case, digits and dashes, unique in the file. Provenance and reviews name it. |
| `kind` | yes | `part`, `axis`, `story` or `status`. |
| `component` | yes | The Figma set: the last segment of the stories' title (`Components/Toggle` is `Toggle`), case ignored. |
| `reason` | yes | Why, in a sentence. Shown in review and in the pull report. No em dash. |
| `by` | no | `claude` or a GitHub login. |
| `where` | no | Which variants: `{ "args": { "size": "sm" }, "state": "hover" }`. A story is in when its props (args over defaults, plus the args Bridge passed) have every listed value, in that state (`rest`, `hover`, `active`, `focus-visible`, `disabled`). Absent: every story of the component. |

Unknown keys are refused, so a typo never passes silently.

### `part`: a spec patch on one part

`part` is a part id from the measure (`cds--toggle-switch`, `root`), or a CSS class with a dot (`.cds--toggle__switch`)
for every part that has it. Give at least one change:

| Key | Values | Effect on the measure the pull reads |
| --- | --- | --- |
| `set` | field -> token path, px number, `null` (no paint, colors only), `"full"` (cornerRadius only) | The part's field values. `"full"` is half the part's shortest side. Fields: fill, stroke, strokeWeight and its sides, cornerRadius, paddings, itemSpacing, counterAxisSpacing, width, height, minWidth, minHeight, opacity, textFill, fontFamily, fontSize, fontWeight, lineHeight, letterSpacing, textDecoration. |
| `width`, `height` | `fixed`, a number (px), `hug`, `fill` | fixed: the measured size (or the number), kept even around content. hug: sized by its content. fill: fills its container (grow along the parent's direction, stretch across it, a root fills its frame). |
| `direction` | `HORIZONTAL`, `VERTICAL` | The part's auto layout direction. |
| `align` | `{ "primary": MIN, CENTER, MAX, SPACE_BETWEEN, "counter": MIN, CENTER, MAX, STRETCH }` | Auto layout alignment. |
| `overlay` | `true`, `false`, `{ "top": 3, "left": 3 }` | true: over its parent, filling it, out of the auto layout. Offsets: pinned there. false: back in the flow. |
| `hide` | `true` | Not drawn, with everything inside it. Goes alone. The root cannot be hidden. |

```json
{ "id": "iconbutton-48", "kind": "part", "component": "IconButton", "part": "cds--btn",
  "width": "fixed", "height": "fixed", "reason": "Carbon's icon button is 48 px square; Figma hugged the 16 px icon." }
{ "id": "toggle-knob-pin", "kind": "part", "component": "Toggle", "part": "cds--toggle-switch-before",
  "overlay": { "top": 3, "left": 3 }, "where": { "args": { "toggled": false } },
  "reason": "The knob sits on the track at the start when off." }
```

### `axis`: how a story arg becomes a Figma property

| `action` | Keys | Effect |
| --- | --- | --- |
| `map` | `arg`, `property` and/or `values` (code value -> Figma value) | The pull names the property and its values that way. Two code values cannot share a Figma value (prune one instead). |
| `ignore` | `arg` | The arg is not a Figma property: it leaves the component's arg list, and stories at another value than its default are left out. |
| `prune` | `where` | The variants `where` names are dropped (a combination the code allows and the library never shows). |

```json
{ "id": "button-kind", "kind": "axis", "action": "map", "component": "Button", "arg": "kind",
  "property": "Kind", "values": { "primary": "Primary", "danger--ghost": "Danger ghost" },
  "reason": "Designers know Carbon's kinds by these names." }
{ "id": "iconbutton-align", "kind": "axis", "action": "ignore", "component": "IconButton", "arg": "align",
  "reason": "Tooltip placement, not a look of the button." }
{ "id": "textinput-no-readonly-hover", "kind": "axis", "action": "prune", "component": "TextInput",
  "where": { "args": { "readOnly": true }, "state": "hover" },
  "reason": "A read-only field has no hover style in Carbon." }
```

### `story`: which story a variant is drawn from

`where` names the variant, `use` the measured render: `{ "story": "<id>", "args": {...}, "state": "..." }` (args and
state pick among several renders of the same story). The render stands for the variant in place of the stories that
matched it; its picture is the story's, its args are the variant's.

```json
{ "id": "toggle-on-story", "kind": "story", "component": "Toggle",
  "where": { "args": { "toggled": true }, "state": "rest" }, "use": { "story": "components-toggle--small-toggle" },
  "reason": "The default story ignores toggled; this one renders it on." }
```

### `status`: an honest status, or a note

With `status` (`differs` or `cant-check`), the component (or the variants in `where`) shows that status with
`reason` as its sentence; without `where` it also replaces the component's entry in `statuses`. Without `status`, the
reason is a note shown with the set. `matches` is refused.

```json
{ "id": "iconbutton-tooltip", "kind": "status", "component": "IconButton", "status": "cant-check",
  "reason": "The tooltip opens on hover in code; Figma draws the button alone." }
```

## What applyFixes returns

`applyFixes(measured, fixes)` returns `{ file, applied }` and never changes its input:

- `file`: the measure with the fixes laid on (the pull's input). Stories a fix changed list it in `fixes`; component
  entries get `figma` hints (`properties`, `values`, `ignored`, `pruned`, `status`, `notes`, `fixes`); `figmaFixes.applied`
  keeps the run.
- `applied`: one record per fix: `applied`, `not-found` (its component, part or story is not in this measure: the code
  or the measure moved, re-check it) or `already` (the file already carried it). Fixes run in file order.

## Review

A fix is a change like any other: it lands through a pull request on `figma-fixes.json`, drafted by Claude (`by:
"claude"`), reviewed by a person. `bridge fixes check` can run in CI next to `bridge check`. The reviewer reads the
reason and the next Check fidelity: the fix stays when the variant moved closer to its shot, and goes back to Claude
with the new gap case when it did not (three attempts, then a `status` fix with the honest reason).
