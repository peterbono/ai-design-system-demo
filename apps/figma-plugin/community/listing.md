# DS Bridge: Figma Community listing

Everything the publish dialog asks for, ready to paste, plus the steps. Images are in this folder; the sources
that render them are in [`src/`](src/) (see "Rebuild the images" at the end).

## Name

```
DS Bridge
```

## Tagline (52 of 60 characters)

```
Pull tokens into Figma. Push edits as pull requests.
```

## Description

Paste as is (plain text with line breaks; use the dialog's list button for the "- " lines if you prefer bullets).

```
DS Bridge connects Figma Variables to the design tokens in your GitHub repository. Git stays the source of truth: designers edit tokens in Figma, and every change goes back as a pull request that people review.

Pull: code to Figma
- Reads the token files (W3C DTCG JSON) from your main branch and shows the plan before anything is written.
- Creates one collection per tier (Primitives, Brand, Base, Semantic, Density, Component) with its modes, light and dark, brands, densities. Aliases are kept across collections, as in code.
- Never overwrites your local edits. Tokens removed in code are flagged, not deleted.

Push: Figma to pull request
- A three-way diff (last pull, Figma now, main now) lists what you changed, with color swatches before and after. Changes on both sides are shown side by side for you to decide.
- Contrast in the pull request: every pair from your contrast file, in every brand and theme, with AA and AAA badges. Failing pairs are flagged before you push, and the token build in CI fails on them.
- Opens a branch with one commit, a changeset and a draft pull request with a change table, contrast before and after, and the risk tier. Nothing is ever written to main. CI and your code owners decide.

Works with any DTCG repository
Add a bridge.config.json at the root of your repository to point DS Bridge at your token folders, tiers, modes and contrast file. Without one, it uses sensible defaults.

Free plan friendly
Plugin API only. On plans limited to one mode per collection, DS Bridge creates one collection per mode and reads them back the same way.

Privacy
- Your GitHub token (a fine-grained token limited to one repository) is stored only in this plugin's client storage on your computer. It is not saved in the Figma file and is never shown again.
- DS Bridge only contacts api.github.com. No analytics, no server of ours, nothing else.

Free and open source (MIT). Docs, source and issues: https://github.com/peterbono/ai-design-system-demo
See it live: https://bridge.floriangouloubi.com
```

## Tags (12 of 12)

```
design tokens, variables, github, pull request, design system, dtcg, git, tokens, contrast, accessibility, code sync, handoff
```

## Support contact

```
https://github.com/peterbono/ai-design-system-demo/issues
```

## Links (description footer, profile or "Learn more" field when offered)

- Live site: https://bridge.floriangouloubi.com
- Repository: https://github.com/peterbono/ai-design-system-demo
- Plugin docs: https://github.com/peterbono/ai-design-system-demo/tree/main/apps/figma-plugin

## Images

| Field | File | Size |
| --- | --- | --- |
| Icon | [`icon.png`](icon.png) | 128 x 128 |
| Cover (thumbnail) | [`cover.png`](cover.png) | 1920 x 1080 |
| Carousel 1 | [`gallery-1-plugin.png`](gallery-1-plugin.png): the plugin UI, Pull and Push | 1920 x 1080 |
| Carousel 2 | [`gallery-2-pull-request.png`](gallery-2-pull-request.png): PR #4, opened by the plugin, in Bridge Reviews | 1920 x 1080 |
| Carousel 3 | [`gallery-3-tokens.png`](gallery-3-tokens.png): the same tokens in the Bridge Studio token explorer | 1920 x 1080 |

The carousel only shows real UI. Gallery 1 is `dist/ui.html` rendered in Chrome against this repository's tokens on
GitHub; outside Figma, the Figma side (the variables and two edits) comes from the plugin's test simulator, as the
caption says. Galleries 2 and 3 are the live pages, unedited.

## How to publish (owner)

You need the Figma desktop app, signed in to the account that will own the plugin. Two-factor authentication
must be on for that account (Figma requires it to publish).

1. Build: from the repository root, `npm install` then `npm run plugin:build`.
2. If the plugin is not imported yet: **Plugins > Development > Import plugin from manifest...** and pick
   `apps/figma-plugin/manifest.json`.
3. Open any design file, then **Plugins > Development > Bridge** and run it once to check it opens.
4. **Plugins > Development > Manage plugins in development**, find DS Bridge, open its **...** menu and choose
   **Publish** (on some versions the entry sits directly under **Plugins > Development > Bridge > Publish**).
5. Plugin id. Done: `manifest.json` holds the published id `1693034743850648023`. For a fork, the publish dialog gives a new id
   (a long number) and asks you to put it in `manifest.json`. Do it, run `npm run plugin:build` again, and
   continue. Then commit the new id on a branch and open a PR (`fix(figma-plugin): published plugin id`), so
   every later build publishes as the same plugin.
6. Fill the dialog from this file: name, tagline, description, icon, cover, carousel images (in the order of
   the table above), tags, support contact. Leave comments on.
7. Network access: nothing to write. The manifest already declares `https://api.github.com` with its reasoning,
   and Figma shows it on the listing.
8. If Figma asks the data security questions: the plugin stores a GitHub token in `figma.clientStorage` on the
   user's computer, sends it only to api.github.com, collects no personal data and has no server of its own.
9. Publish. Figma reviews new plugins before they appear in Community; it usually takes a few working days and
   you get an email either way.
10. Once it is live, set the docs site's plugin link to the Community page: Vercel project `bridge-docs` >
    Settings > Environment Variables > `PLUGIN_URL` = the Community URL, for Production, then redeploy.

Later releases: build, then **Publish new version** from the same menu, with release notes. The id stays the same.

## Rebuild the images

Needs Google Chrome installed (one headless instance at a time) and the repository dependencies.

```sh
npm run plugin:build
cd apps/figma-plugin
OUT=/tmp/ds-bridge-shots && mkdir -p $OUT
npx esbuild community/src/snapshot.ts --bundle --platform=node --format=esm --target=node20 --conditions=source --outfile=$OUT/snapshot.mjs
node $OUT/snapshot.mjs $OUT/push.json color/text/muted=palette/neutral/700 color/action/primary/bg=palette/primary/800
echo '{"fileName":"Bridge tokens","collections":[],"variables":[]}' > $OUT/pull.json
export GITHUB_TOKEN=$(gh auth token)   # read-only GitHub calls; the pages never see it
node community/src/plugin-shots.mjs $OUT/pull.json $OUT pull
node community/src/plugin-shots.mjs $OUT/push.json $OUT push
node community/src/web-shots.mjs $OUT
node community/src/render.mjs $OUT   # writes icon.png, cover.png, gallery-*.png here
```
