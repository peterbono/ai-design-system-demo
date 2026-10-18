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
4. **Merge (ship)**: by a human who holds the ship right (see [Roles](#roles-who-approves-and-who-ships)) and has
   write access to the repo. Agents do not merge. A listed owner may merge past missing approvals only, with a
   written reason (see [Owner override](#owner-override-solo-maintainers-and-small-teams)).
5. **Release**: Changesets turns merged changesets into a version bump and `CHANGELOG.md`.

## Protection: Bridge is the only way in

Every tool may propose, none may write to the library directly. Bridge, Studio, the DS Bridge Figma plugin, the
CLI, the MCP server, Claude Code, Claude Design and developers all write to a branch and open a pull request. The
default branch only changes when a reviewed pull request merges.

- **Consumers read only.** Products install the published `@bridge-ds/*` packages from npm. Nothing they run
  writes to this repository.
- **Publishing happens in one place.** Only `.github/workflows/release.yml`, on a push to `main` (a merged pull
  request), versions and publishes to npm, and only once the `NPM_TOKEN` secret is set. Pull request snapshots
  (`preview-packages.yml`) go to pkg.pr.new, never to the npm registry.
- **Production deploys from the default branch only.** Vercel builds production from `main`; every other branch
  gets a preview deployment.
- **GitHub enforces it.** A repository ruleset named "Protect the library (main)" targets the default branch
  (`~DEFAULT_BRANCH`, so it follows a rename) with four rules:

| Rule | What it stops |
| ---- | ------------- |
| `deletion` | Nobody deletes the default branch. |
| `non_fast_forward` | Nobody force pushes or rewrites its history. |
| `pull_request` (1 approval or more, stale approvals dismissed on a new push) | No direct push: every change merges through a reviewed pull request, and what was approved is what merges. |
| `required_status_checks` | The CI jobs must pass before a merge. The names come from the repository's own CI: the check runs of the default branch's latest commit that also ran on the last merged pull request, without Vercel and skipped runs. |

- **Owner override.** The ruleset lets repository admins bypass it in pull request mode only: an admin may merge a
  pull request whose approvals are missing (the [owner override](#owner-override-solo-maintainers-and-small-teams),
  with its written reason), but cannot push to the default branch either.
- **Studio shows it and sets it up.** The Protection row in Studio, Settings says whether the library is protected, partly
  protected (and what is missing), not protected, or unknown (no token, or the token cannot read it). "Protect the
  library" creates the ruleset with the viewer's token after a confirmation; "Complete protection" replaces Bridge's
  ruleset when one exists. It needs a repository admin, and a fine-grained token with Administration: Read and
  write. `bridge check` prints the same state; the logic is `protection.ts` in `@bridge-ds/core`.
- **Plans.** GitHub Free does not enforce rulesets on private repositories. Studio says so and links to
  Settings, Rules; make the repository public or upgrade the plan.

## Roles: who approves and who ships

`governance.owners` lists the design owners and the tech owners. `governance.rights` says which of those two
groups holds each right. Each team changes it in Studio, Settings, Roles, which proposes the edit as a pull request
on `bridge.config.json` (a guardrail file, so it is reviewed at Tier 3).

```json
"governance": {
  "owners": { "design": ["dana"], "tech": ["theo"] },
  "rights": { "approveDesign": ["design"], "approveTech": ["tech"], "ship": ["tech"] }
}
```

| Right | Default | What it means |
| ----- | ------- | ------------- |
| `approveDesign` | `["design"]` | Whose approval counts as the design approval. |
| `approveTech` | `["tech"]` | Whose approval counts as the tech approval. |
| `ship` | `["tech"]` | Who may merge the pull request, which publishes the change to the products. A team may let design owners ship too: `["design", "tech"]`. |

- A right left out of `rights` takes its default. Each value lists one or both of `"design"` and `"tech"`.
- **Without `rights`** Bridge behaves as before the field existed: approvals follow `owners`, and anyone with write
  access to the repo may ship.
- A right whose groups list no login singles nobody out: anyone with write access may ship.
- Shipping still needs write access to the repo (push, maintain or admin), read from the token. When the viewer
  lacks the ship right, Reviews keeps Merge off and says who can, for example "Only the tech owner can ship this
  (@theo)."
- The owner override skips missing approvals only. It never lets someone ship who does not hold the ship right.
- The same rules live in `@bridge-ds/core` (`rights.ts`: `approverLists`, `shipPolicy`, `canShip`) for Studio, the
  CLI and the MCP server.

### Roles by team

An owner entry is a person or a GitHub team. A company assigns roles by team and manages who is in each team in
GitHub, as it already does for code owners. Bridge stores no membership: it reads it from GitHub when it needs it.

```json
"owners": { "design": ["@acme/design"], "tech": ["@acme/web", "theo"] }
```

- A person is a login, with or without `@`: `"theo"`, `"@theo"`. A team is `"@org/team-slug"`, the slug from the
  team's URL on GitHub. Anything else fails `bridge check` (and every Bridge surface that loads the config) with
  the entry named and both forms spelled out.
- A team counts as its members: an approval counts for a role when the reviewer is in a listed team, and a member
  of a team holding the ship right may ship. Studio checks the viewer's membership of that team before it enables
  Ship.
- Sentences name the team as a team, with its size: "Waiting for the design owner (@acme/design (4 people)) to
  approve.", "Only the tech owner can ship this (@acme/web (6 people))."
- Reading a team needs a token that may read the organization: `read:org` on a classic token, or Members: Read on
  the organization for a fine-grained token. GitHub never shows team members anonymously.
- **A team Bridge cannot read is never treated as empty**, because an empty owner list means "any reviewer counts".
  It keeps its place: nobody's approval counts for it and nobody ships through it, and every surface says why and
  how to fix it. The reasons: no token or a refused one (connect GitHub), a token without `read:org`, a team slug
  GitHub does not know, or a repository owned by a personal account (teams only exist in organizations: list
  people instead, or move the repository to an organization).
- Studio Settings, Review rules shows each team as a chip with its member count and avatars, and its Edit mode
  takes a person or a team (it suggests the organization's teams when the token can list them). The change is sent
  for review like any other edit of `bridge.config.json`.
- `bridge check` lists the teams with their size and reports each team it cannot read, with the fix. Like the
  protection line, this never changes the exit code (a CI token often cannot read organization teams). The MCP
  review tool returns the same roles: who may approve design, approve tech and ship, with teams named.
- In `@bridge-ds/core`, `teams.ts` parses entries (`parseOwnerEntry`) and reads teams with `TeamDirectory`
  (paginated `GET /orgs/{org}/teams/{slug}/members`, `GET /orgs/{org}/teams/{slug}/memberships/{user}` for one
  person, cached for five minutes), returning a typed "cannot read" state with its reason.

## Visual before and after

`.github/workflows/visual-impact.yml` screenshots what a pull request changes, before and after. When it runs is
`visualImpact.mode` in `bridge.config.json`, read from the default branch so a pull request cannot switch it:

- `"auto"` (the default, also when `visualImpact` is absent): on every pull request that touches tokens,
  components, the admin app or Storybook.
- `"on-demand"`: only when the pull request has the `visual-check` label, or from a manual run of the workflow with
  the pull request number. Studio offers "Show the visual impact" on the pull request, which adds the label with the
  viewer's token (write access needed; without it, Studio links to GitHub). Teams with private repos use it to save
  GitHub Actions minutes.

A small first job reads the mode with `jq` and skips the screenshot job otherwise. Adding `visual-check` always
runs it, in both modes; any other label never does.

## Owner override (solo maintainers and small teams)

GitHub never lets authors approve their own pull request, so a repo with one maintainer, or a team where the
only other owner is away, can never collect a design and a tech approval. The owner override is the explicit,
audited way through. It is off unless `bridge.config.json` turns it on:

```json
"governance": {
  "owners": { "design": ["peterbono"], "tech": ["peterbono"] },
  "override": { "allowed": ["peterbono"], "requireReason": true, "minReasonLength": 20 }
}
```

**Who.** Only the GitHub logins in `governance.override.allowed`, and only when their token has write access to
the repo (push, maintain or admin). Bridge reads the login from the token (`GET /user`) and the access from
`GET /repos/{owner}/{repo}`. Agents never use it: agents do not merge.

**When.** Only when the one thing missing is approvals. The override is never offered while:

- CI fails or is still running,
- someone requested changes,
- the pull request is a draft, closed, or has a merge conflict.

The normal Merge button stays off with its reasons. "Merge as owner override" is a separate, secondary action in
the Ready to merge panel of Reviews, behind a confirmation dialog that names the missing approvals.

**Audit trail.** Before merging, Bridge posts a comment on the pull request. Its first line is always
`**Bridge owner override**`, followed by:

```text
Owner override by @login: <reason>. Missing: design approval, tech approval. Merged from Bridge.
```

The reason is required (at least `minReasonLength` characters, 20 by default). The squash or merge commit
message repeats it. If GitHub refuses the merge, for example because branch protection requires an approving
review, Bridge shows GitHub's message and rewrites the comment to end with `Merge refused by GitHub: <message>.
Not merged.`, so the record never claims a merge that did not happen. History and the PR timeline find
overrides by that first line.

**Branch protection still wins.** The override changes what Bridge allows, not what GitHub enforces. With the
Bridge ruleset (see [Protection](#protection-bridge-is-the-only-way-in)), the override merge goes through for a
repository admin, who may bypass it in pull request mode; for anyone else GitHub refuses it. With classic branch
protection that requires reviews, it goes through for an admin only when "Do not allow bypassing the above
settings" is off. Remove a login from `allowed` (a Tier 3 change, `bridge.config.json` is a guardrail file) to take the
override away.

**Token permissions.** A fine-grained token limited to the repo, with Contents read and write (merge), Pull
requests read and write (reviews, PR comments, close), Commit statuses read and Checks read (CI), and
Metadata read (always on).

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
