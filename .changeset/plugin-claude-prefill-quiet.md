---
'@bridge-ds/figma-plugin': patch
---

"Ask Claude to fix it" now opens Claude with the request already written (`claude.ai/new?q=…`). The designer presses send there. The request is also copied, and one line says to paste it if the message comes up empty. The progress row follows the fix-session contract exactly: "Claude went quiet" comes from the server's `quiet` flag on a working session, never as "Claude stopped: …". The elapsed time and round come from the session itself, and the plugin reads it every 10 seconds while the plugin is open.
