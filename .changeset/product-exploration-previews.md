---
"@bridge-ds/core": patch
"@bridge-ds/mcp": patch
"@bridge-ds/cli": patch
---

Explorations in a product's own repository, from Claude and the CLI: "Done exploring" links each request to the preview Vercel reported in the product repository (a long branch name gets a shortened alias the template cannot guess, so the requests linked the pull request instead), `bridge explore continue` and `bridge_continue_exploration` give the preview, and their next step stays in the product repository instead of suggesting a token proposal on a branch the design system does not have. The draft body says where the preview link is and no longer mentions a preview prerelease the product repository does not have. New in core: `productPreviewOnGitHub`.
