# PR draft: `agent/badge-subtle-variant`

**Title:** feat(badge): add subtle appearance for dense lists

**Author:** AI agent (Claude), opened as draft. Human review required before merge.
**Risk tier:** 2, medium (new variant, additive, no token change)
**Changeset:** `@demo-ds/react` minor

## What changed and why

Closes #12 (example issue: "Solid badges are too loud in the releases table").

- Adds `appearance?: 'solid' | 'subtle'` to `Badge`. Default stays `solid`, so existing usages do not change.
- `subtle` uses the existing semantic tokens `--color-feedback-<tone>-bg`, `-border` and `-text`.
  Neutral subtle uses `--color-border-default` and `--color-text-muted`.
- No new tokens, no primitive references, no literal values.
- Stories: new `Subtle` and `AllTonesSubtle`; `appearance` added to controls.

## Checks run by the agent

| Check | Result |
| ----- | ------ |
| `npm run tokens:build` | pass |
| `npm run typecheck` | pass |
| `npm run lint:css` | pass |
| `npm run build-storybook` | pass |

## What the human reviewer must check

- [ ] **Design:** open `Components/Badge/AllTonesSubtle` in light **and** dark. Is subtle visibly lower
      emphasis than solid but still readable at 12px?
- [ ] **A11y:** Accessibility panel shows no contrast violations for every tone, both themes
      (warning text on the tinted background is the most likely to fail).
- [ ] **API:** is `appearance` the right prop name, consistent with future components (vs `variant`)?
- [ ] **Scope:** only Badge files and one changeset changed.
- [ ] **Semver:** additive prop with an unchanged default, so `minor` is correct.

## Suggested decision

Approve after design review if both themes pass the a11y panel.
