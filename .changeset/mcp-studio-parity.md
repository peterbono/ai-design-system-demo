---
"@bridge-ds/core": minor
"@bridge-ds/mcp": minor
"@bridge-ds/cli": minor
"@bridge-ds/docs-site": patch
---

Studio parity: every action a designer takes in Bridge Studio now works with Claude (MCP) and in the terminal.

- MCP: 20 new tools for branches in review (what needs me, status, send for review, back to draft, review, ask someone else to review,
  comment and reply, merge through Studio's gate with the owner override, close, reopen, update from main with
  token conflicts, try it in a product and share it, try 2 to 4 branches together), docs saved for review,
  explorations promoted or closed, products, settings and Figma coverage. `bridge_propose_token_change` takes
  `pr` (add edits to a branch in review), `jira` and `product`; explorations and requests take `product`.
- CLI: `bridge branch ...`, `bridge products`, `bridge settings`, `bridge coverage`, `bridge docs save`, and
  `--product`, `--jira`, `--pr` where work starts.
- Core: the review and merge rules, the branch writes, update from main, sharing, try in product, try together,
  docs proposals and Jira keys moved from the docs site into `@bridge-ds/core`, so Studio, the MCP server and
  the CLI run one implementation. New `products` list in `bridge.config.json` (schema included), defaulting to
  Admin demo and Library; Studio's Branches page groups by it with the same result.
