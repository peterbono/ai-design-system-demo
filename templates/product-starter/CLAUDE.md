# This product

Started from Bridge (the Bridge product starter). Vite + React, built with the team's library (`@bridge-ds/react`,
`@bridge-ds/tokens`) and the Bridge toolbar (`@bridge-ds/toolbar`, mounted in `src/main.tsx`).

`.bridge/product.json` links this code to the team's design system and names this product's key there. Bridge writes it
when it starts the product. If it still names `the-bridge-company/ai-design-system-demo` and `new-product` while this product
belongs to another team, run `npx -y @bridge-ds/cli connect --ds <owner/name> --product <key>` once and commit the
result.

<!-- bridge:start -->
## Bridge design system

This product's UI uses the team's design system through the Bridge MCP server in `.mcp.json` (it reads
`.bridge/product.json`). `bridge connect` rewrites this section when it runs.

- Build screens with the library: look up components and tokens with the Bridge tools (`bridge_get_component`, `bridge_search_tokens`, `bridge_get_token`) before writing a component or a value. Never hardcode a value a token covers.
- Explorations are free: when the designer wants to try something, start one with `bridge_start_exploration`, named from their words. No brief, no purpose needed.
- "Continue Bridge exploration #12": call `bridge_continue_exploration`. It switches this checkout to the `explore/<name>` branch when nothing is uncommitted, and says where it stands: start your answer with that.
- Work, commit and push on that branch. Never open a pull request to main from it, and never change the library from here.
- Mark each new or changed area of the UI with `data-bridge-change="<short plain label>"` on its outermost element, so the Bridge toolbar can show it.
- At the end, the designer picks the pieces the library should get: `bridge_missing_pieces`, then Done exploring (`bridge_promote_exploration`) with the pieces they chose.
<!-- bridge:end -->
