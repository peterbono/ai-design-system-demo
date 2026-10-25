---
"@bridge-ds/cli": patch
"@bridge-ds/core": patch
---

CLI errors say how to recover: `propose` names `--file` and `--mode` (not the MCP fields) for a token defined in several files, and explains a missing or non-array `--edits` file instead of a JavaScript error; `audit --baseline` with a file that is not an audit report no longer prints "undefined"; `snapshot --activity` without a token says how to read GitHub without a stray write hint; `request show` on another issue points to `bridge request list`; bad JSON for `docs save` and `figma push` says what to pass.
