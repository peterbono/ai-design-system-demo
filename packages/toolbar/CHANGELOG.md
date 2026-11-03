# @bridge-ds/toolbar

## 0.8.1

### Patch Changes

- Updated dependencies [de71095]
  - @bridge-ds/core@0.28.0

## 0.8.0

### Minor Changes

- 9970737: The toolbar reads a change of a private product: Bridge Studio hands a member's tab a short-lived read pass in the link's fragment, the toolbar takes it out of the address, keeps it for the tab and sends it with its reads through Bridge. When the change still cannot be read, Live product keeps working for a code change, the toolbar names the change by its branch (else "This exploration") and points back to Studio instead of asking for a reload.

### Patch Changes

- 80a2a9b: The collapsed toolbar says what you are looking at and flips in one click. It reads "Bridge", the change's title (ellipsis, the full title in a tooltip) and the same Live product | This change switch as the open bar, so the main action no longer hides behind expand; the grey "This change" chip that looked like a disabled button is gone. The chevron is "Show Bridge details". A side that cannot be opened yet stays focusable and its tooltip says why. On a phone the title gives way first, then the wordmark below 360px; the switch always stays.

## 0.7.0

### Minor Changes

- aa2b67e: Previews on any host, not only Vercel. Core reads a branch's preview from GitHub deployments of any host, commit statuses (Vercel, Netlify) and Cloudflare Pages check runs (`parseCloudflareCheck`, `isCloudflareCheck`), matches links to an app by its template's host (`appForUrl`), and fills `{branch}` with each host's alias rule (`previewHostOf`, `cloudflareBranchAlias`). Studio reads check runs for non-Vercel products, Add a product detects Netlify and Cloudflare Pages, the developers' version link falls back to Cloudflare's check run, and the toolbar treats a page whose host matches the preview template as a preview when the build sets no deploy environment.

### Patch Changes

- Updated dependencies [aa2b67e]
  - @bridge-ds/core@0.27.0

## 0.6.0

### Minor Changes

- ae1c7b2: Toolbar: a change that lives in the design team's copy of a product stays readable on This change and on Live product. Studio's link names the copy (`bridge-repo`), the toolbar keeps it for the session and across the switch, and the host can pass it as the new `repo` prop. The "Nothing changed in view" note is gone.

### Patch Changes

- Updated dependencies [ae1c7b2]
  - @bridge-ds/core@0.26.1

## 0.5.0

### Minor Changes

- b131960: The design team's copy of a product: `products[].design` (`{ "repo", "preview"? }`) names a fork of the product's repository that the design team owns. Explorations of that product start in the copy, never in the developers' repository, and "Done exploring" sends the developers a task there instead of a branch: an issue labeled `from-design` with the preview, the files the prototype changes, the library pieces it needed, and how to fetch the prototype code from the copy. Studio's product page offers "Make my copy" while there is none (a fork in the copy's organization, every branch) and "Get the latest" when the product moved on (GitHub's Sync fork); an exploration in the copy opens in Claude Code on the web with the copy selected and the branch named. New core exports: `designCopyOf`, `productCodeRepoOf`, `productOfDesignCopy`, `designCopyStateOnGitHub`, `makeDesignCopyOnGitHub`, `waitForDesignCopy`, `getLatestDesignCopyOnGitHub`, `designTaskBody`, `designTaskTitle`, `designCopyTakeCommands`, `DESIGN_COPY_STARTING_POINT`, `FROM_DESIGN_LABEL`; `GitHubClient` gains `forRepo`, `createFork`, `mergeUpstream` and `ensureLabel`; the exploration block gains `task`. The toolbar takes a `repo` override (the deploy's own repository): on a deploy of the copy it reads the copy's explorations and previews. Art print shop moved to `art-print-shop-co/art-print-shop`, explored in `art-print-shop-co/art-print-shop-design`.

### Patch Changes

- Updated dependencies [ff5d30f]
- Updated dependencies [b131960]
- Updated dependencies [87e4794]
- Updated dependencies [d1d97bb]
- Updated dependencies [194c7a1]
- Updated dependencies [4967d1f]
- Updated dependencies [8890c22]
  - @bridge-ds/core@0.26.0
  - @bridge-ds/react@1.8.3

## 0.4.1

### Patch Changes

- Updated dependencies [59c0cca]
- Updated dependencies [61b4f83]
- Updated dependencies [faf78be]
  - @bridge-ds/core@0.25.0

## 0.4.0

### Minor Changes

- 4ea433f: Code changes now show what changed in the Bridge toolbar. An exploration marks each new or changed area of the UI with `data-bridge-change="<short plain label>"` on its outermost element; on This change the toolbar outlines those areas, counts them ("1 changed", "1 / 3 changed"), steps through them with Previous and Next, isolates them (Esc exits) and lists them in Changes, and C toggles the outlines. On Live product the bar says how many wait on This change. A change without markers says so plainly. Bridge now asks Claude for these markers wherever it explains how to explore: the MCP server instructions, the start and continue answers, and the section `bridge connect` writes into a product's CLAUDE.md (core exports `CHANGE_MARKER_ATTR` and `CHANGE_MARKER_RULE`).

### Patch Changes

- Updated dependencies [4ea433f]
  - @bridge-ds/core@0.24.1

## 0.3.0

### Minor Changes

- e71bc5b: The toolbar shows what changed without being asked. On a token change, opening the bar outlines every changed surface of the screen and counts them in the bar ("3 changes"); the count also turns the outlines off and on (C). Previous and Next scroll to each change in reading order (smooth, or instant with reduced motion), outline the current one stronger and announce it to screen readers. Isolate dims everything but the changes, off by default, and Esc turns it off. Outlines, position and Isolate hold on the Live product side, which shows the same elements. When nothing changes on the screen the bar says so and names the screens the change shows on, with a way to go there. The B shortcut to flip sides in place is shown in the side buttons' tooltip. The token swatches moved from the bar into the Changes sheet, with their before and after values, to keep the bar compact; at 390px the changes take a second row.

### Patch Changes

- 07788aa: The count of changed elements no longer reads like "This change": the bar says "13 changed", then "2 / 13 changed" while stepping, and screen readers hear "Changed element 2 of 13: Avatar" (also with changes tried together). The before and after tooltip of the current element now opens below it when there is room above the bar, else beside it, and above it only as a last resort, so the title above the element stays readable and the tooltip never covers the bar.
- Updated dependencies [4264fa0]
  - @bridge-ds/core@0.24.0

## 0.2.0

### Minor Changes

- 7af0bfc: The Bridge toolbar reads GitHub through Bridge's read proxy (new `proxy` prop, default production Bridge) instead of anonymous browser calls, so Before and After keep working past GitHub's 60 reads an hour per visitor. It reads GitHub directly when Bridge refuses or cannot be reached. Bridge's read proxy answers GET reads of public demo teams to the product origins their bridge.config.json names (CORS, no credentials).

### Patch Changes

- Updated dependencies [a367cfe]
- Updated dependencies [f8a1085]
  - @bridge-ds/core@0.23.0

## 0.1.0

### Minor Changes

- 11926c5: New package: the Bridge toolbar as a component any React product mounts in one line,
  `<BridgeToolbar ds="owner/design-system" product="<key>" />`. Opened from Studio with `?bridge=<change>`, it flips the
  real product between Live product (production) and This change (the branch preview) and shows what changed for token
  changes. It reads the product's repository, production URL and preview template from the design system's
  bridge.config.json, renders nothing and loads nothing without `?bridge=`, and ships its styles inside its lazy chunk.
  The Admin demo now mounts it from this package, with the same behaviour.

### Patch Changes

- Updated dependencies [8f73c2d]
  - @bridge-ds/core@0.22.0
