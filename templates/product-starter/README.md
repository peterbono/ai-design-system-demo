# Bridge product starter

The code Bridge starts when a team adds a product that has no code yet (Studio, Add a product, "No code yet? Start a
new product"). Bridge copies this starter into the team's GitHub account with the person's own sign-in, writes
`.bridge/product.json` (the team's design system and the product's key), and proposes the product in the team's
`bridge.config.json` for review.

- `npm install`, then `npm run dev`.
- Previews: import it on Vercel or Cloudflare Pages (Bridge offers both links right after it starts the product).
  Every branch then gets a preview, and Bridge finds it after the first change.
- The Bridge toolbar (`src/main.tsx`) renders nothing until Studio opens the product with `?bridge=<change>`.

Publishing: this folder lives in the Bridge repository (`templates/product-starter`). It is published as the public
GitHub template repository `peterbono/bridge-product-starter` (Settings, "Template repository" ticked), which is what
Bridge generates from (`TEMPLATE_REPO` in `apps/docs-site/src/lib/new-product.ts`).
