# @bridge-ds/admin

## 0.1.2

### Patch Changes

- 11926c5: New package: the Bridge toolbar as a component any React product mounts in one line,
  `<BridgeToolbar ds="owner/design-system" product="<key>" />`. Opened from Studio with `?bridge=<change>`, it flips the
  real product between Live product (production) and This change (the branch preview) and shows what changed for token
  changes. It reads the product's repository, production URL and preview template from the design system's
  bridge.config.json, renders nothing and loads nothing without `?bridge=`, and ships its styles inside its lazy chunk.
  The Admin demo now mounts it from this package, with the same behaviour.
- Updated dependencies [11926c5]
  - @bridge-ds/toolbar@0.1.0

## 0.1.1

### Patch Changes

- 67ae8f7: Variants and props for the gaps Studio and the admin worked around.

  - Button and IconButton: `pressed` makes a toggle (`aria-pressed`, a selected fill and a Deep Harbor edge; the look follows the attribute, so a script can drive a static toggle). Button `variant="link"` looks like a text link and stays a button, with the DS focus ring. `variant="inverse"` is the action on a strong surface (Deep Harbor, `color.surface.inverse`).
  - SegmentedControl: `appearance="strong"` fills the selected segment with Deep Harbor. Any number of segments: when they do not fit (a phone), the track scrolls sideways and fades the edge that hides segments instead of widening the page, and the selected segment scrolls into view. The focus ring now sits inside the segment so the track never clips it.
  - Select: `badge` on an option (a status or a count), shown on the item and in the trigger once selected. `portalContainer` on Select and Combobox.
  - Combobox, Select and Menu popups sit on the popover layer, above a Dialog or Drawer, so a list opened inside a dialog is never covered.
  - Menu: `icon` also takes an element (a brand mark); leading icons and indicators show reliably and keep labels aligned.
  - Table: `width` (token length, percentage or a fraction like `0.35`) and `minWidth` on TableHead and TableCell, `layout="fixed"`, and `narrowLayout="stack"`: under about 480px each row becomes a card, every value beside its column name (`label` on a cell, or the header text).
  - Alert: `actionsPlacement="inline"` puts the action at the end of a short message and under it on a phone.

  Adopted in Studio (Changes status filter on phones, the Viewing select's status badges, view and edit banners, Components "need guidance" filter, Settings approvals on phones, Start a change menu icons and families), on the Library site (terminal Copy buttons, Accessibility Compare) and in the admin Bridge toolbar (Before/After and Show what changed toggles). Homemade CSS for these is removed.

- Updated dependencies [f1a8b55]
- Updated dependencies [67ae8f7]
- Updated dependencies [0cfc3ff]
  - @bridge-ds/react@1.2.0

## 0.1.0

### Minor Changes

- 4c313d7: Try several changes together. On Studio > Changes (Open), each change has a checkbox; checking 2 to 4 token changes combines them in the browser: the latest library plus each change's own token edits (what it changed since it started, so a change that is behind never undoes newer library values). Nothing is written to GitHub. A token two changes set differently gets one row ("Use Darker default background's" or the other change's), and nothing opens until each has a pick; the contrast checks then run on the combination itself ("All 296 contrast checks pass with these changes together."). A change that edits code is left out and says why on its row ("This one changes code, so it can't be combined here."). "Try 3 changes together" opens the demo admin with `?bridge=101,118,120`: the Bridge toolbar applies the combined tokens live on the production admin (no preview holds all of them, and it says so), "These 3 changes" replaces "This change", its Changes sheet lists the changes with a checkbox each to switch one off live, and Before/After (B) and Show what changed (C) work on what is switched on, the tooltips naming the change a value comes from. "View the library with them" opens Studio Tokens, Components and Quality on `?change=101,118` (the #116 address model, with the picks in `use`): the banner names the changes, changed tokens are marked "Changed in #118", and Quality shows no combined numbers. Core gains `changeEdits`, `combineChanges` and `encodePicks`/`decodePicks` (token-combine), and `previewOverrides`/`cssOf` move to core (css-overrides) so Studio and the admin share them.
- ee2417d: Show what changed. The Bridge toolbar in the admin demo outlines every surface of the current screen whose computed style differs between the live product and a token change: the live tokens are switched on and off inside one task (no visible flash, transitions held), and only real differences are kept. A surface is the outermost changed element (a sticky or fixed one counts on its own, a chart counts once); it gets a dashed Deep Harbor frame, and a role chip ("Page", "Save bar (Save changes)", "Link (Open customer)", "Shop logo", "Chart") on hover, from its list row, or briefly when outlines turn on. Tooltips lead with the role the change edits ("Brand primary") and its before and after. The toggle counts the visible surfaces ("Show what changed · 3"), the Changes sheet lists them first as focusable rows (screen reader equivalent), and the toolbar keeps clear of them. Press C to toggle. The toolbar and the outlines keep Bridge's own colours, pinned from the live tokens, whatever the change does. Code changes do not get it: their live side is another origin whose styles cannot be read.
- fa28131: Try it in the product. The change detail in Studio links to the demo admin preview Vercel reported for the change, on the admin screen that changes most. Opened that way, the admin shows a Bridge toolbar: flip between the live product and this change (B), see each changed token as a before and after swatch, and jump to every screen the change alters. Token changes swap the live tokens in place; code changes move between the live admin and the preview on the same screen. Production shows nothing unless it is the live side of a code change.

## 0.0.1

### Patch Changes

- d6c0889: Studio and the admin demo fill wide monitors: pages no longer stop at about 1000 to 1260 px with an empty column on the right. Past about 1800 px of content the page stops growing and sits centred beside the side nav.
- Updated dependencies [dfa95ed]
  - @bridge-ds/react@1.1.0
