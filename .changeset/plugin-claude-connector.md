---
'@bridge-ds/figma-plugin': minor
---

Claude runs in the team's own Claude account, with Bridge as a connector. The plugin has no API-key path anywhere.
- **Removed:** the "Draft with Claude" API-key route, the Anthropic key field and model picker in Settings, `api.anthropic.com` from the manifest, and the server-run wiring to `/api/claude`. "Draft with Claude" uses only the designer's own Claude.
- **Ask Claude to fix it** copies the request ("Fix IconButton in Figma with Bridge") and opens Claude to paste it in. The first time in a file, one sentence says to add Bridge to the team's Claude once, with "How to connect" (Studio Settings, Claude). "Copy for your developer" stays as the fallback.
- **The row follows Claude:**
  - "Waiting for Claude", with "Open Claude again";
  - "Claude is working on IconButton · 4 min, round 2 of up to 3", with Claude's real steps folded below, newest last (a pulse on the current one, a check on finished ones, static with reduced motion);
  - "Claude's fix is ready", with "See Claude's fix" and the Check for updates line;
  - or "Claude stopped: …" / "Claude went quiet", with "Copy for your developer".
- **Where the row gets its information:** steps come from the Bridge site. Without them, the plugin watches GitHub for the draft pull request on `bridge/figma-fixes-<component>` labelled `figma-fixes`. It looks gently while the plugin is open and resumes when it opens again.
