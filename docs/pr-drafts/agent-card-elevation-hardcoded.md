# PR draft: `agent/card-elevation-hardcoded`

**Title:** feat(card): lift interactive cards on hover

**Author:** AI agent (Claude), opened as draft. Human review required before merge.
**Risk tier:** 2, medium (new prop and visual state)
**Changeset:** `@demo-ds/react` minor

> This draft is kept as an example of a PR that **should not be merged as is**. CI fails on the
> Stylelint guardrail. It shows what the review looks like when the agent takes a shortcut.

## What changed and why

Closes #18 (example issue: "Clickable cards need a hover affordance").

- Adds `interactive?: boolean` to `Card`. When true, the card lifts on hover (shadow + 1px translate,
  translate disabled under `prefers-reduced-motion`).
- New story `Components/Card/Interactive`.

## Checks run by the agent

| Check | Result |
| ----- | ------ |
| `npm run tokens:build` | pass |
| `npm run typecheck` | pass |
| `npm run lint:css` | **fail** (2 errors) |
| `npm run build-storybook` | not reached in CI (lint step fails first) |

`npm run lint:css` output on this branch:

```
packages/react/src/components/Card/Card.module.css
  15:15  ✖  Unexpected value "0 8px 24px rgba(16, 24, 40, 0.12)" for property "box-shadow"  declaration-property-value-allowed-list
  15:26  ✖  Unexpected function "rgba"                                                      function-disallowed-list

✖ 2 problems (2 errors, 0 warnings)
```

## What the human reviewer must check

- [ ] **Guardrail:** the hover shadow is a hardcoded `rgba()` value. The system already has
      `--elevation-overlay` (light: `shadow.md`, dark: `shadow.md-strong`). The literal also ignores the
      dark theme, where this shadow is nearly invisible.
- [ ] **No workaround:** confirm the agent did not add `stylelint-disable`, edit `.stylelintrc.json`
      or use `!important` to get past CI. (It did not.)
- [ ] **Design:** is "lift on hover" the right affordance, or should interactive cards use a border
      change instead? Decide before the agent iterates.

## Review decision

**Request changes.** Replace the literal with the token, then re-request review:

```css
.interactive:hover {
  box-shadow: var(--elevation-overlay);
}
```

If design wants a different hover depth than `elevation.overlay`, that is a new semantic token
(`elevation.hover`), which makes this a Tier 3 token PR with design + tech approval.
