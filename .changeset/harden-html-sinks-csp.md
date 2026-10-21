---
'@bridge-ds/docs-site': patch
'@bridge-ds/core': patch
---

Harden every HTML sink against repo and GitHub content, and ship a report-only Content-Security-Policy. Markdown links allow only http, https, mailto and relative targets, JSON embedded in pages can no longer close its script element, PR, preview, Figma, Jira and image URLs go through one URL allow-list, token values in inline styles drop `url()` and declaration breakouts, and docs.json example props lose raw HTML, handlers and unsafe URLs. A test lists every file that writes HTML with what makes it safe. `tryInProductUrl` returns an empty string for a preview that is not http or https. The docs site sends `Content-Security-Policy-Report-Only` (inline scripts allowed by hash, checked at build time), `X-Content-Type-Options` and `Referrer-Policy`, and collects violations on `/api/csp-report`.
