---
"@bridge-ds/core": patch
"@bridge-ds/mcp": patch
"@bridge-ds/cli": patch
"@bridge-ds/docs-site": patch
---

The exploration page picks up where you left off. While an exploration runs, Studio shows one of two states. Not started (nothing on the branch beyond the Bridge note): "Not started", who started it, "Nothing built yet" with the line to paste in Claude (Claude app or Terminal), "Continue in Claude" that copies it, "See the product today" and an empty "Your preview" frame. Exploring: who changed what and when in words (files mapped to screens and components, else the commit subject), the preview with "Open the preview" and "Continue in Claude", the "Happy with it?" card with Done exploring, and the last 3 events. The breadcrumb items sit on one baseline. Core adds the shared words (`explorationStage`, `continueLines`, `explorationActivity`, `lastActivity`, `whereItStands`) and `GitHubClient.listPullRequestCommits`. Claude resolves "Continue Bridge exploration #12" (or shop#12) with the new `bridge_continue_exploration` tool (`bridge explore continue` in the CLI): it switches a clean checkout to the branch and starts by saying where it stands. At the start of a session the server instructions have Claude offer, once, to continue the person's running explorations (`bridge_list_explorations` takes `mine`).
