---
"@bridge-ds/core": minor
"@bridge-ds/cli": minor
"@bridge-ds/mcp": patch
---

Library protection: Bridge is the only way into the default branch.

Core: new `protection.ts` with `protectionRuleset` (the repository ruleset on `~DEFAULT_BRANCH`: no deletion, no
force push, pull request with at least 1 approval and stale approvals dismissed, required checks, admins may bypass
in pull request mode only), `protectionState` (protected, partial, unprotected or unknown, with what is missing,
from rulesets and classic branch protection), `requiredCheckNames` (read from the repository's own CI, without
Vercel and skipped runs) and `protectionSentence`. `protection-github.ts` adds `loadProtection`,
`loadRequiredChecks`, `protectLibrary` and `protectRefusal`. The GitHub client gains `listRulesets`, `getRuleset`,
`createRuleset`, `updateRuleset` and `getBranchProtection` (404 means none, 403 means it cannot be read), and check
runs carry their app slug.

CLI: `bridge check` prints whether the library is protected and where to fix it. It never changes the exit code;
`--offline` (or `BRIDGE_OFFLINE=1`) skips it, and `--json` adds `protection`.

MCP: the server instructions say every write goes through a branch and a pull request, never straight to the
default branch.
