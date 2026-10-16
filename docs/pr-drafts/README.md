# PR drafts

Each simulated agent branch adds its own PR description here, so the draft travels with the change:

| Branch | Draft file | Tier |
| ------ | ---------- | ---- |
| `agent/badge-subtle-variant` | `agent-badge-subtle-variant.md` | 2, medium |
| `agent/focus-ring-token` | `agent-focus-ring-token.md` | 3, high (token change) |
| `agent/card-elevation-hardcoded` | `agent-card-elevation-hardcoded.md` | 2, CI fails on purpose |

```sh
git diff main...agent/focus-ring-token      # read the change
git show agent/focus-ring-token:docs/pr-drafts/agent-focus-ring-token.md
```

In a hosted repo these would be pull request descriptions, not files.
