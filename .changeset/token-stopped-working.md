---
"@bridge-ds/core": minor
"@bridge-ds/docs-site": patch
"@bridge-ds/figma-plugin": patch
---

Say clearly when the GitHub token stopped working (revoked, regenerated or expired), instead of scattered errors.

Core: `GitHubError` gains `auth` (`'rejected'` for a 401, `'missing-permission'` for a 403 "Resource not accessible
by personal access token" or a permission GitHub names in `X-Accepted-GitHub-Permissions`) and `permission`
(`issues`, `pull_requests`, `contents`...: from the header, else from the endpoint). Rate limits stay rate limits.
New exports: `classifyAuth`, `requiredPermission`, `isTokenRejected`, `isMissingPermission`,
`missingPermissionMessage`, `permissionLabel`, `TOKEN_REJECTED_MESSAGE`, `TOKEN_SETTINGS_URL`. A refused token now
stops an exploration promotion instead of becoming a warning.

Studio: one session state. Any 401 marks the saved token as stopped working (it is kept, not deleted): the sidebar
account block shows "Your GitHub token stopped working" with Reconnect (the connect dialog, field focused, saving
replaces the token), Settings says the same, write actions show that one message, and reads fall back to anonymous.
A missing permission is named on the action that needs it ("This token cannot create issues. Add Issues: Read and
write on GitHub.") with a link to the token settings. The token is checked once on load when the last check is older
than an hour (GET /user, cached with its result).

DS Bridge plugin: the Settings token row shows "Stopped working" with "Replace token" after a 401; Pull, Push and the
other GitHub flows show one callout, "Your GitHub token stopped working. Replace it in Settings.", with a button that
goes there. Access is checked once when the plugin starts. A missing permission is named, with the GitHub link.
