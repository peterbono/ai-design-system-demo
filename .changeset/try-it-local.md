---
'@bridge-ds/core': minor
'@bridge-ds/mcp': minor
'@bridge-ds/cli': minor
---

Try it works without online previews: when nothing reported a deployment for an exploration (explorations and library branches are not deployed on Vercel any more), the Figma plugin says a developer opens it on their computer, the share message gives `git fetch origin && git switch <branch>`, polling stops, and `bridge branch try` / bridge_try_branch return the same local command (`local`). New core helpers: noOnlinePreview, localTryCommand.
