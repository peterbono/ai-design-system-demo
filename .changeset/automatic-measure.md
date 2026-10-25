---
'@bridge-ds/core': minor
'@bridge-ds/cli': minor
---

The automatic measure: `measureWorkflowYaml` and `measureWorkflowOptionsFromConfig` (core) generate `.github/workflows/bridge-measure.yml`, which measures a team's Storybook each time it changes (after each deploy of a deployed Storybook, or on pushes that change it with Storybook built in the run, plus a weekly fallback) with `bridge specs --measure --variants --tokens --shots --check` in headless Chrome, and publishes `measured-specs.json` and `measured-shots/` to the `bridge-requests` branch only when the measure changed, with the run's `GITHUB_TOKEN` only. New `bridge measure setup` writes it from `bridge.config.json`, and `bridge init` offers it. Studio, Settings, Claude shows the measure of the components and, for developers, Set up automatic measure (a pull request that adds the workflow, or the file to commit from GitHub when the app cannot write workflows); new docs page /docs/automatic-measure/ and docs/MEASURE.md; templates/bridge-measure.yml for teams.
