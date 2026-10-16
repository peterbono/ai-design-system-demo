---
"@bridge/core": minor
"@bridge/visual": minor
"@bridge/mcp": minor
"@bridge/cli": minor
---

Visual impact analysis for design system changes. `@bridge/core` gains a usage index (CSS variables each component reads, components it renders). New `@bridge/visual` builds Storybook and the admin app at two refs, screenshots the impacted stories (every brand and theme) and the admin screens (every tenant and theme) deterministically, and pixel-diffs them into before, after, diff and composite images plus a JSON manifest. `bridge impact` and the `bridge_visual_impact` MCP tool run it; a workflow posts the result on pull requests.
