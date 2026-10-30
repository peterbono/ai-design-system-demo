---
"@bridge-ds/core": patch
"@bridge-ds/docs-site": patch
---

"Try it in the product" never opens a canceled deployment. When Vercel's Ignored Build Step skipped a branch's build (an exploration that only has its note file), the branch alias opened "Deployment was cancelled". Core now marks such a preview `skipped` (from the Vercel commit status description or its comment), `productPreview` and `previewLinksOf` leave it out, and `CommitStatusLike` carries the status `description`. In Studio, a product branch with no build of its own opens the product as it is today (its production URL, else its preview pattern on the default branch) with "Same as the product today. Your preview appears after the first change." next to the button; a build in progress says "Preview is building" and a failed one "Preview not available yet", with the details under For developers. While exploring, the page no longer asks the designer to check what is missing from the library: the sentence and the "Missing from the library" zone show once the pieces were checked or after Done exploring.
