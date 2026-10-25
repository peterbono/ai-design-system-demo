---
'@bridge-ds/figma-plugin': minor
---

"Ask Claude to fix it" runs Claude for the team when the designer signed in with Bridge.
- **Start:** the plugin starts the run on Bridge (`POST /api/claude`, using the Studio sign-in token).
- **While it runs:** the row shows "Claude is on it" and the round. The plugin keeps asking while it is open, one request at a time after `retryAfter`.
- **When it ends:** "Claude's fix is ready" lists what the fix does, offers "See Claude's fix" (the review in Studio) and says that Check for updates brings it in once approved. A run without a fix shows Bridge's sentence only.
- **On open:** reopening the plugin picks up the team's runs still moving, and the ready ones show under "Claude's fixes".
- **Refusals:** when Claude is not connected for the team, or the hourly limit is reached, Bridge's sentence shows with "Copy for your developer". A pasted token keeps the copy path.
