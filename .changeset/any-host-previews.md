---
"@bridge-ds/core": minor
"@bridge-ds/mcp": patch
"@bridge-ds/cli": patch
"@bridge-ds/toolbar": minor
"@bridge-ds/docs-site": patch
---

Previews on any host, not only Vercel. Core reads a branch's preview from GitHub deployments of any host, commit statuses (Vercel, Netlify) and Cloudflare Pages check runs (`parseCloudflareCheck`, `isCloudflareCheck`), matches links to an app by its template's host (`appForUrl`), and fills `{branch}` with each host's alias rule (`previewHostOf`, `cloudflareBranchAlias`). Studio reads check runs for non-Vercel products, Add a product detects Netlify and Cloudflare Pages, the developers' version link falls back to Cloudflare's check run, and the toolbar treats a page whose host matches the preview template as a preview when the build sets no deploy environment.
