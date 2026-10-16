---
'@bridge-ds/core': minor
---

Branch previews: `previews.production` in `bridge.config.json` holds the production URL of each app (docs, Storybook,
admin demo), and `appUrl()` picks the branch preview on a feature branch and the production URL on the default branch
or in a local build. The docs site links its Storybook through it.
