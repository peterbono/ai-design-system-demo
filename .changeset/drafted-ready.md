---
'@bridge-ds/core': minor
'@bridge-ds/mcp': minor
'@bridge-ds/cli': patch
---

Marking a Figma change drafted (`bridge_mark_figma_change_drafted`, `bridge figma drafted <n>`) now also marks its pull request ready for review, in the same step, through GitHub's `markPullRequestReadyForReview` mutation. Ready goes first: when GitHub refuses it, the labels and the description stay as they were and the error says why, so a branch is never labelled `drafted-by-claude` while reviewers cannot see it. `markFigmaChangeDraftedOnGitHub` returns `ready: true`.

The Bridge MCP server (and `bridge mcp`) uses your gh sign-in (`gh auth token`) when `GITHUB_TOKEN` and `BRIDGE_GITHUB_TOKEN` are not set, and says once at start where its token came from, or that it runs without one (read-only, 60 requests an hour) and how to fix that. It never logs the token. The other CLI commands keep their rule: writes use your gh sign-in only with `--use-gh-auth`.
