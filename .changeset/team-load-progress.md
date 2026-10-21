---
'@bridge-ds/core': minor
'@bridge-ds/docs-site': minor
---

Show how far Bridge has gone reading a design system, and open Branches for teams.

- Core: `loadRepoModel` takes `onProgress` and reads in three phases (tokens, components, docs) with an exact file
  total from the first report; `readRepoTexts` takes an `onProgress(done, total)` callback; `gitHubSource` takes
  `onProgress` (the tree once read, then each body and whether it came from the blob cache).
- Team pages (Home, Components, Quality, Tokens) replace the loading skeleton with a calm progress view: "Finding your
  design system", then "Using the saved snapshot" or "Reading N files" with a bar filled from real file counts
  ("Reading tokens 12 of 48", then components, then docs), then "Ready". Unknown totals stay indeterminate, a cache
  hit shows nothing. The Storybook quick start shows "Reading your Storybook" and the component count it found.
- Team Branches lists the team's open branches (the same list as the demo) and its open suggestions, each reviewed
  in place. Review and New brand keep one calm line and "See it on the demo"; "View on GitHub" is gone.
