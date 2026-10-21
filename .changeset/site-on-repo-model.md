---
'@bridge-ds/docs-site': patch
'@bridge-ds/core': patch
---

The docs site builds from the repo model: `loadRepoModel(fsSource(root))` runs once per build (`lib/model.ts`) and
the token, component, contrast, explorer, history, Figma coverage, config and sign-in libs read it instead of their
own parsers and hardcoded paths. `bridge.config.json` is parsed once; the site's settings come from core
`siteRepoFromConfig`. A model problem (invalid config, unresolved alias, contrast pair on a missing token, docs.json
that does not parse) fails the build, as before. Core fix: a component's description is the JSDoc right before the
component, no longer everything from the first JSDoc of the file (a documented props interface leaked into it). The
`href` option of `loadRepoModel` also receives the token path.
