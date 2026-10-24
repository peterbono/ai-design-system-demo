---
"@bridge-ds/core": patch
"@bridge-ds/mcp": patch
"@bridge-ds/react": patch
---

Designer words: screens a designer reads say "change" and "library", never branch, merge or main. The share and
product-branch sentences of `@bridge-ds/core` (`shareDescription`, `SHARE_EXPLAIN`, `libraryPreviewState`,
`productBranchSentence`) now read "This change was added to the library", "Your feature uses a preview of the library
change". The MCP fallback share sentence follows. ChoiceCard docs examples say "your change". Gate reasons, status
labels and developer texts (CLI, MCP, GitHub) keep their git words.
