---
"@bridge-ds/figma-plugin": minor
---

"Draft with my Claude": your own Claude (Claude Desktop or Claude Code on your plan, no API key) writes request and Push texts through the Bridge MCP server. The plugin writes the changes and the before and after images to the `bridge-requests` branch, shows "Waiting for your Claude" with the sentence to say, checks every 5 seconds for up to 10 minutes, fills the fields you did not edit and offers Claude's text for the ones you did, then deletes the file once you send or cancel. Settings, Claude (optional), now lists three ways: MCP (recommended, with the Claude Desktop config and the Claude Code command), Copy for Claude, and an API key ("Draft with Claude (API key)").
