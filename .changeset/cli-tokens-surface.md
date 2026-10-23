---
'@bridge-ds/cli': patch
'@bridge-ds/mcp': patch
'@bridge-ds/core': patch
---

The bridge CLI never writes on GitHub with a credential you did not pass: writes (suggestions, requests, reviews, comments, merges, branches) use `GITHUB_TOKEN`, `BRIDGE_GITHUB_TOKEN` or `--token`, or your gh sign-in only with `--use-gh-auth`. Reads may still use the gh sign-in, say so in one line on stderr, and cannot write. `bridge branch merge --dry-run` needs no write token. A merge the gate blocks exits 1, not 2, and `bridge --help` documents the exit codes. CLI messages name commands and flags (`bridge branch merge 12 --override "why"`), never MCP tools or JSON fields, the rate-limit message says how to pass a token in the CLI, and suggestions, pull requests and docs proposals made from the CLI say "the bridge CLI" and "source: cli". `bridge_get_config`, the server instructions and its start line say what Bridge may write in the same sentence. `bridge docs help`, `bridge brand help` and `-v`/`-h` work, `bridge tokens` says when it shows only the best matches (`--limit`), `bridge diff` explains a bad git ref, `bridge coverage` counts the 53 components once and says what the other numbers are, `bridge audit --fix` keeps what the audit keeps (ignore comments, `--allowlist`, `audit.exclude`) and takes `--json`, and a Figma change drafted by Claude no longer says so twice.
