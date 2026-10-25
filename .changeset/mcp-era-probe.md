---
'@bridge-ds/mcp': patch
'@bridge-ds/docs-site': patch
---

Explain the one 400 that opens every Claude session on the hosted connector: Claude probes the stateless MCP 2026-07-28 revision first and falls back to initialize when Bridge (2025-11-25 and earlier) answers 400 without a modern error, as the spec's era detection says. A test replays the handshake (probe 400, initialize 200, initialized 202, tools/list 200).
