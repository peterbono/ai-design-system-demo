---
"@bridge-ds/core": minor
"@bridge-ds/docs-site": minor
---

Owner override for solo maintainers and small teams. `governance.override` in `bridge.config.json` (`allowed`, `requireReason`, `minReasonLength`; absent by default) lets listed logins merge from Reviews when the only thing missing is approvals. It is never offered while CI fails or runs, when changes are requested, or on a draft. Bridge checks the token has write access, asks for a reason in a confirmation dialog, posts a `**Bridge owner override**` comment with the login, reason and missing approvals, then merges with the method the repo allows. If GitHub refuses, its message is shown and the comment is marked not merged.
