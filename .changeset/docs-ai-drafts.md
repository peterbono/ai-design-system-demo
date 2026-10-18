---
"@bridge-ds/core": minor
"@bridge-ds/mcp": minor
"@bridge-ds/figma-plugin": patch
"@bridge-ds/docs-site": minor
---

Docs drafted with Claude in place, at three levels: the whole page (fill, or rewrite every section), one section, or a
selected passage (clearer, shorter, or in the Bridge voice). Fill drafts the empty sections and never rewrites written
ones: when the code is newer than docs.json, written sections are sent as checks, and Claude returns one only when
something in it is no longer true for the code (the writer's wording kept elsewhere). Results say which checked
sections are still accurate (`checked`) and which were updated (in `sections`). Same rule for MCP docs items
(`DocsDraftTask.check`, `DraftResult.checked`).

Core: new `docs-ai.ts` with the task model (`DocsDraftTask`, `validateDocsTask`), the prompts (`docsTaskPrompt`,
`docsSelectionPrompt`; `docsPrompt` takes `{ keys, rewrite, outdated }` to ask for only some sections), the answer
parsing and sanitizing to the docs.json shapes with em dashes removed (`parseDocsReply`, `sanitizeDocsSections`,
`parseDocsTaskAnswer`, `sanitizeDocsReplacement`), the merges (`applyDocsSections`, and `mergeDocsDraft` for the
docs-draft Action) and the Messages API request (`anthropicRequest`, `anthropicReplyText`). docs.json gains
`draftedSections` (the prose sections a partial draft wrote, between `draftedBy` and `needsReview` in
`formatDocsJson`); `markClaudeDraft(d, sections)` adds to it, `acceptDocsDraft` clears it, `sectionsNeedingReview`
reads it. The draft exchange takes `docs` items (scope `"docs"`, source `"studio"`) whose results carry `docs` (the
sections) or `replacement`; `createDocsDraftSession`, `ensureRequestsBranch` and `DraftPoller` move to core.

MCP: `bridge_pending_drafts` and `bridge_write_drafts` explain docs items and accept `docs` or `replacement` results
(title and summary are optional now, still required in practice for change items).

Docs site: `src/scripts/docs-ai.ts` (`draftDocs`, `draftAvailability`, `outdatedSections`, `saveApiKey`,
`applyDraft`) drafts with the designer's own API key (browser call, key kept in this browser only) or their own
Claude through the exchange, from `/docs-ai/<slug>.json` (the facts from the code and the repo conventions, built
with the site). The docs-draft Action now runs the same core code.
