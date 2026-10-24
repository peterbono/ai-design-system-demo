---
"@bridge-ds/core": patch
"@bridge-ds/react": patch
---

Component specs match the code in two places the generator misread: menu parts drawn alone take the popup's snug line height, and the page header title takes its desktop (h1) size, as width media queries are now read at the 1200 px the code images use.
