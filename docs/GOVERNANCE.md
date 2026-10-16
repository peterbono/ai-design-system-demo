# Governance

How changes get into the design system, whoever writes them. AI-authored and human-authored PRs go
through the same gates; agent PRs are additionally labelled and never self-merged.

## Risk tiers

| Tier | Examples | PR state | Required approvals | Changeset |
| ---- | -------- | -------- | ------------------ | --------- |
| 1, low | Docs, story fixes, a11y fixes with no visual change, lint fixes, a token description edit (no value change) | Ready for review | 1 code owner | `patch` or none (docs only) |
| 2, medium | New component, new variant or prop, visual tweak using existing tokens | Draft until design review | Design owner + tech owner | `minor` |
| 3, high | Token added, changed, renamed or removed; breaking prop change; guardrail or `AGENTS.md` change | Draft, labelled `tokens` or `breaking` | Design owner **and** tech owner, mandatory | `minor` (added or changed token) or `major` (renamed or removed token) |

If a PR spans tiers, the highest tier applies. The DS Bridge plugin, the docs site editor and Reviews, the CLI
and the MCP server compute the tier with the same classifier (`classifyRisk` in `@bridge-ds/core`).

## Review gates

1. **CI must be green**: token build, typecheck, Stylelint, Storybook build, changeset present.
   A red check is never fixed by disabling a rule or deleting a test.
2. **Design review** (Tier 2 and 3): open the Storybook preview, check light and dark, check the
   Accessibility panel, check keyboard focus, compare against the intent in the linked issue.
3. **Tech review**: API shape, naming, semver level, no new dependency without reason.
4. **Merge**: by a human code owner. Agents do not merge.
5. **Release**: Changesets turns merged changesets into a version bump and `CHANGELOG.md`.

## Who approves what

| Area | Design owner | Tech owner |
| ---- | ------------ | ---------- |
| Token values and names | Approves | Approves |
| Component visuals, states, a11y | Approves | Reviews |
| Component API, types, build | Reviews | Approves |
| CI, lint rules, `AGENTS.md` | Approves | Approves |

`@design-owner` and `@tech-owner` in `.github/CODEOWNERS` are placeholders. Branch protection with
"Require review from Code Owners" is what turns this table into an enforced rule.

## Branches from the Figma plugin (`tokens/*`)

DS Bridge (`apps/figma-plugin`) turns Figma variable edits into pull requests:

- Branches are named `tokens/<slug>-<yyyymmdd-hhmm>`, with a single commit that only touches the
  changed token files plus a changeset (`minor`, or `major` when a token is renamed or removed).
- Value, type, rename and removal changes are **Tier 3** (token change); a change that only edits
  descriptions is Tier 1 (`patch`). Tier 3 PRs are opened as draft, labelled `tokens`, and they need
  **design owner and tech owner** approval, like any other token change.
- The plugin refuses to open the PR while its guardrails fail (aliases, cycles, scopes, type changes,
  WCAG contrast on `packages/tokens/src/contrast.checks.json`). That is a convenience, not a gate:
  CI and CODEOWNERS remain the authority.
- If you want stricter handling, add a branch protection or ruleset entry for the pattern `tokens/*`.

## Reviewing an AI-authored PR

Read it as you would a junior contributor's PR, with extra attention to things an agent does confidently
and wrongly:

- **Check the tier.** Did the agent under-classify? A "small style fix" that adds a token is Tier 3.
- **Read the CSS diff, not only the summary.** Look for literal values that slipped past lint
  (for example a spacing value that should be a scale step).
- **Look for invented tokens.** A `var(--something)` that does not exist in `dist/tokens.css` renders as
  nothing. Search the generated CSS for every new variable name.
- **Open the stories in both themes.** Agents often check light only.
- **Check that nothing was removed to pass CI.** Deleted stories, loosened lint config, `stylelint-disable`.
- **Ask for the token, do not accept the workaround.** If a change needs a value the system does not have,
  the right outcome is a token proposal, not a hardcoded value.

Example drafts on the `agent/*` branches (see `docs/pr-drafts/README.md`) show one PR per tier, including one that should be rejected.
