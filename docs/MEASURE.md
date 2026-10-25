# The automatic measure

**For designers:** Bridge measures what your components really look like in code, every variant with a picture, and
keeps that measure fresh each time your Storybook changes. It is what lets "Ask Claude to fix it" (Figma plugin) and
Claude's fixes in Studio work. Without it, they say "Bridge hasn't measured your components yet. A developer turns it
on once: Set up automatic measure." Designer page: `/docs/automatic-measure/` on the Bridge site.

## Where the measure lives

| File | Where | Read by |
| --- | --- | --- |
| `measured-specs.json` | the `bridge-requests` branch (the automatic measure), or the repo root (committed by hand, wins) | the Claude fix tools (`bridge_figma_gaps`, `bridge_get_gap_case`, `bridge_try_figma_fix`, `bridge_propose_figma_fixes`, `bridge gaps`, `bridge fix`), the Figma plugin (Measured spec sources, "Ask Claude to fix it", gap cases), Studio (Settings, Claude) |
| `measured-shots/` (`manifest.json` + PNGs) | next to `measured-specs.json`, same branch | the plugin (Check fidelity against the story renders, update previews), gap cases |
| `figma-fidelity.json` | the repo root, else `bridge-requests` | the fix tools (unchanged: the plugin writes it after Compare with code) |

One reader for all: `findMeasure` in `packages/core/src/measure-location.ts` (the repo at the ref read, then
`MEASURE_BRANCH`, which is `REQUESTS_BRANCH`). Large files are read with the raw media type: a measure of every
variant is over the 1 MB the contents API inlines. The missing-measure words are there too (`MEASURE_MISSING_TEXT`,
`measureSetupSteps`, `MeasureMissingError`): `bridge_figma_gaps` answers `status: "no-measure"`, never a raw error.

Why the data branch: the measure is data, not code. On the default branch it would mean a pull request on every
Storybook change; on `bridge-requests` a workflow publishes it with the run's own token, next to the plugin's run.

## The workflow

`.github/workflows/bridge-measure.yml`, from one generator, `measureWorkflowYaml` in
`packages/core/src/measure-workflow.ts`. Everything that writes it uses it:

- `npx @bridge-ds/cli measure setup [--storybook <url> | --build] [--force] [--print]` writes the file from
  `bridge.config.json` (default branch, `previews.production.storybook`, the components' and tokens' folders);
- Studio, Settings, Claude, For developers, **Set up automatic measure** opens a pull request that adds it, with the
  person's own GitHub sign-in. GitHub only lets an app write workflow files with the **Workflows** permission; without
  it, Studio gives the file to commit from GitHub (Open on GitHub, Copy the workflow);
- `templates/bridge-measure.yml` (the default output) and this repository's own copy. A test
  (`packages/core/test/measure-workflow.test.ts`) keeps both equal to the generator; re-render with
  `BRIDGE_UPDATE_WORKFLOWS=1 npx vitest run --project core packages/core/test/measure-workflow.test.ts`.

What it does:

1. **When.** Deployed Storybook: after each successful deploy of it from the default branch (`status` events, as
   Vercel and Netlify report deploys, whose context names the Storybook; or `deployment_status` outside previews), and
   only when that commit touches the paths that change the Storybook (`git diff HEAD^ HEAD -- <paths>`). Built in the
   run: on pushes to the default branch touching those paths. Both: Mondays at 05:17 UTC, and by hand.
2. **Measure.** `bridge specs --measure --storybook <url> --variants --states rest,hover,active,disabled --tokens
   --shots --check`, headless Chrome (`BRIDGE_CHROME_CHANNEL=chrome`, preinstalled on `ubuntu-latest`). Built in the
   run: `npm run build-storybook`, served on `http://127.0.0.1:6006` with `python3 -m http.server`.
3. **Publish, only when it changed.** The measure and the shots manifest are compared with what `bridge-requests`
   holds, without `measuredAt` and `createdAt`. Same: nothing is committed. Else one commit
   (`bridge measure: <sha>`) replaces `measured-specs.json` and `measured-shots/`, pushed with a rebase and retry (the
   plugin writes to the branch too). No `bridge-requests` yet: it starts from the default branch, as the plugin does.

**Token:** only the run's `GITHUB_TOKEN`, `contents: write`, pushing `bridge-requests` only (branch protection on the
default branch is untouched). **Secrets:** none. Optional `NPM_TOKEN` (passed as `NODE_AUTH_TOKEN` to the install) for
a private registry. A Storybook behind a login: `--build`, the run builds it itself.

## This repository

`.github/workflows/bridge-measure.yml` measures `https://bridge-storybook.floriangouloubi.com` after each Vercel
deploy of `bridge-storybook` from main that touches `packages/react/src`, `packages/tokens/src` or `.storybook`, with
the local build of the CLI.
