---
"@bridge-ds/figma-plugin": minor
"@bridge-ds/mcp": patch
---

Compare with code: "Ask Claude to fix all N" under the summary, when two or more components that differ can go to
Claude. One click writes the comparison once, opens the team's Claude once with one request naming them all ("Fix
these 31 components in Figma with Bridge: AccordionItem, AlertDialog/Popup, ..."; a list too long for Claude's address
opens on "Fix every component that differs in Figma with Bridge", the full request is copied either way) and every row
then waits for its own fix. Each row keeps its own "Ask Claude to fix it". The first time in a file, the connect
sentence shows once for the list. The Bridge MCP server's instructions say a request naming several components means
all of them, one at a time, each proposed before the next. The box that says Claude opened with the request no longer
leaves an empty icon slot: its text lines up with the "Waiting for Claude" box below.
