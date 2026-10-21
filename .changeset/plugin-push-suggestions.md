---
"@bridge-ds/figma-plugin": minor
---

Push goes through suggestions when the repo takes them (`"changes": "suggest"` in `bridge.config.json`, the default). The checked variable edits become a token suggestion with the exact edits, a new brand a brand suggestion, and each component change a token or component spec suggestion that links the Figma nodes Claude Code reads the design from. No branch or pull request is written. Screenshots still go to the `bridge-requests` branch when the token can write contents; a suggest-only token (Contents Read, Issues Read and write, Pull requests Read) gets the node links and a plain note that screenshots need write access. The button reads "Send suggestion", the result "Suggestion #N sent to your DS lead", and the token help names the permissions for each mode. Direct mode is unchanged.
