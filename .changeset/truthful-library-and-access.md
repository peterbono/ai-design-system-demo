---
"@bridge-ds/mcp": patch
"@bridge-ds/docs-site": patch
---

`bridge_get_claude_design_system` no longer asks someone to create a second Library artifact. When Bridge has none on
record for the team, an admin or lead gets `create` (with "if you already made one, update and save that one"), anyone
else gets `ask` (ask an admin or lead to add it; load the Library from its base URL meanwhile). The local server, which
keeps no team settings, answers `unknown` with `teamKnown: false` instead of `create`, and a failed read of the team
setting is an error, never "none". `bridge_list_products` adds `access`, one plain sentence per person: a member Bridge
writes for (Can edit or Admin) can start and save explorations in the design team's copy, shown `connected`, while the
developers' code stays read only; a Reader is told to ask an admin for Can edit.
