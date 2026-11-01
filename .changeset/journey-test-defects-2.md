---
"@bridge-ds/core": patch
"@bridge-ds/docs-site": patch
---

More fixes from the journey tests. Starting an exploration in a design team's copy hands Claude the copy and the branch, never the developers' repository, and "Open the exploration" opens it in its product. An exploration that cannot be read says so in designer words. Being built reads the pull request of an older Claude fix, so a merged one reads Shipped. A merged change shows no approval rows, and the only owner who made a change is pointed to the owner override. An exploration handed to developers reads "Waiting to be picked up" everywhere, the same words as the Being built tab.
