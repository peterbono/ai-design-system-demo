# Sources

References used to shape this operating model. Summaries are short and paraphrased; read the originals.

| Topic | Source |
| ----- | ------ |
| DTCG token format reaches its first stable version (2025.10): `$value`, `$type`, aliases, color and dimension objects | https://www.w3.org/community/design-tokens/2025/10/28/design-tokens-specification-reaches-first-stable-version/ |
| Storybook 10.3 release notes (this repo uses Storybook 10.3 with react-vite and addon-a11y) | https://storybook.js.org/blog/storybook-10-3/ |
| GitHub Primer: exposing a design system to agents through MCP | https://primer.style/product/getting-started/foundations/mcp |
| Atlassian: testing a portable DESIGN.md versus structured context (MCP, skills) and lint | https://www.atlassian.com/blog/how-we-build/atlassians-design-md-is-here-what-we-learned-testing-portable-design-context-in-practice |
| Why many design systems are not ready for AI agents | https://www.intodesignsystems.com/blog/design-system-not-ready-for-ai-agents |
| Builder.io: making AI agents follow a design system | https://www.builder.io/blog/how-to-make-ai-agents-follow-your-design-system |
| Murphy Trueman: design systems fragmenting into per-tool agent files | https://blog.murphytrueman.com/your-design-system-is-fragmenting-into-agent-files/ |
| Figma: opening the canvas to agents | https://www.figma.com/blog/the-figma-canvas-is-now-open-to-agents/ |
| zeroheight: state of AI in design systems | https://zeroheight.com/resources/state-of-ai-in-design-systems/ |

## How they show up here

- **DTCG 2025.10** is the token file format; Style Dictionary 4 builds it.
- **Primer MCP and Atlassian**: structured, queryable context plus lint beats a long prose guide.
  Here that means a short `AGENTS.md`, a typed `tokens.ts`, and Stylelint in CI. No MCP server is built.
- **Agent-file fragmentation**: one `AGENTS.md`; `CLAUDE.md` only imports it, so tools do not drift apart.
- **Figma canvas open to agents**: agents can now act in Figma too, which makes a single reviewed source of
  truth more important, not less. Figma stays the exploration space.
