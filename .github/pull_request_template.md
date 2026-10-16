## What changed and why

<!-- One paragraph. Link the issue. If an agent authored this PR, say so and link the session or prompt. -->

Closes #

## Risk tier

<!-- See docs/GOVERNANCE.md. Pick one. -->

- [ ] Tier 1, low: docs, stories, lint or a11y fixes, no visual or API change
- [ ] Tier 2, medium: new component, variant or prop (additive). Opened as draft until design review
- [ ] Tier 3, high: token added/changed/removed, breaking API, or guardrail change. Design + tech owner approval required

## Authored by

- [ ] Human
- [ ] AI agent (Claude), reviewed by a human before merge

## Design review checklist

- [ ] Uses tokens only: no hex, rgb, hsl or raw shadows in component CSS (`npm run lint:css` passes)
- [ ] Semantic tokens used in components, not primitives, for color and elevation
- [ ] Checked in Storybook in **light and dark** themes
- [ ] Accessibility panel in Storybook shows no violations; keyboard focus is visible
- [ ] Stories added or updated for every new state
- [ ] Changeset added with the right bump (`patch` / `minor` / `major`)
- [ ] No lint rule disabled, no test or story deleted

## Screenshots

| Light | Dark |
| ----- | ---- |
|       |      |
