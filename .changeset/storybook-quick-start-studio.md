---
'@bridge-ds/docs-site': minor
---

Studio reads a published Storybook without the repository. Onboarding step 2 takes a Storybook URL: "Add Storybook"
reads its index, keeps the address in this browser and says how many components it found. Studio > Components from
Storybook (`/studio/components/storybook/`) lists them by family, with search, and opens a drawer per component with a
live preview of each story or docs page, or a link to Storybook when the host does not allow embedding. Tokens,
contrast checks and suggestions say in one line that they need the repository connected. A new `/api/storybook`
function reads the index server side when the host sends no CORS header and reports whether previews may be framed,
behind SSRF guards: https only, public addresses only after DNS, fixed paths, 3 redirects, 5 s, 5 MB.
