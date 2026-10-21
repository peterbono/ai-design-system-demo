---
'@bridge-ds/react': minor
'@bridge-ds/figma-plugin': patch
---

The agent mark of `Avatar kind="agent"` (and `avatarHtml({ kind: 'agent' })`) is now the Field Guide robot from the
landing page: a rounded head with an antenna, two dot eyes, a smile, side ears and two legs, drawn as one round-cap
stroke in currentColor with no fill, so it keeps the tile contrast in light and dark and reads at the xs size (16px
mark). It replaces the prompt chevron and cursor. `AGENT_MARK` keeps its shape (`viewBox`, `path`, `strokeWidth`,
`color`); its `viewBox` is now `0 -0.8 24 24` and its `strokeWidth` 1.8. The accessible name stays "Claude AI". Studio,
the Library and the docs pick it up through the Avatar; the regenerated component specs carry it to the Figma plugin.
