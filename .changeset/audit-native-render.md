---
"@bridge-ds/core": patch
---

`bridge audit` no longer counts a native element passed as a component's render element (`<Button render={<a href="/tokens" />}>`) as a separate native UI instance, as it already did for router links: the DS component is the UI.
