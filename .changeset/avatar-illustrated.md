---
"@bridge-ds/react": minor
"@bridge-ds/tokens": minor
"@bridge-ds/docs-site": minor
---

Avatar: illustrated faces and Claude's identity.

- `Avatar fallback="illustrated"`: without a photo (or when it fails), a drawn face that is always the same for the same `seed` (a login), on the Harbor zone color. The drawings are the DiceBear "Notionists" style (design CC0 1.0 by Zoish, code MIT), generated locally with no network. They weigh about 120 kB gzipped, so they live in a separate entry: import `Avatar` from `@bridge-ds/react/avatar-illustrated`. The main entry keeps initials as the default and stays light; `illustration` takes a ready image if you draw faces yourself.
- `Avatar kind="agent" brand="claude"`: the Claude mark on a cream tile, same round shape as people, named "Claude AI", to attribute work Claude did. The Claude mark is an Anthropic trademark: check the Anthropic brand guidelines before shipping it in a product.
- `avatarHtml()` in `@bridge-ds/react/dom`, the same markup for rows built in plain scripts.
- Tokens: `color.illustration.surface` (the Harbor zone color, a lighter step in dark so line drawings stay readable) and `avatar.illustrated-bg`; `color.agent.surface` (cream, the same in both themes), `avatar.agent-bg` and `avatar.agent-border`.
- Studio: change rows, the change and history details and explorations show a face and the person's display name instead of "@login"; work Claude made, and Claude's guidance drafts, show Claude's identity.
- Studio Quality: the library health cards (contrast checks, adoption, guidance) open the page, with their detail below, and Share copies a short summary for Slack or a slide or downloads the header as an image.
