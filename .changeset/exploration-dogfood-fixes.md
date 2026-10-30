---
"@bridge-ds/core": patch
"@bridge-ds/mcp": patch
"@bridge-ds/cli": patch
"@bridge-ds/docs-site": patch
---

Exploration fixes from dogfooding. The draft pull request title keeps the name as typed and never doubles the prefix ("Exploration: Exploration page, pick up where you left off"). Branch slugs go up to 60 characters, cut on a word boundary, so a valid name is kept whole. A person's commit with Claude's co-author trailer is credited to the person ("Florian with Claude"); Claude alone only when no person authored it (`isClaudeAssisted`, `humanAuthorOf`, `actorName`). The pull request body lists every configured preview app and points to the Vercel comment when the branch is too long for a predictable link, instead of saying previews are not set up. In Studio, signed-out visitors read display names from the commits and the author's public profile, and visitors without write access no longer see the Done exploring card; while the preview builds, the button reads "Preview is building" with a spinner at full contrast. `npm run build -w @bridge-ds/cli` builds @bridge-ds/mcp first when its dist is missing or stale, so the CLI no longer crashes in a fresh worktree.
