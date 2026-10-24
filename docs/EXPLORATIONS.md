# Explorations

Try experimental variables and components in a real product staging branch, without touching `main`.

An **exploration** is a branch named `explore/<name>` with an open **draft** pull request labeled `exploration`. It
holds token edits and component work, gets the same per-branch previews and snapshot packages as any pull request,
and is **never merged as is**: when the idea is validated it is promoted to a normal pull request for review,
otherwise it is closed.

| What | Where it comes from |
| --- | --- |
| Branch `explore/<name>` from `main`, first commit `.bridge/explorations/<name>.md` (the purpose) | Studio, `bridge explore start`, or Claude (`bridge_start_exploration`) |
| Draft pull request "Exploration: ...", labeled `exploration`, body with purpose, where the install command is, previews, promote and close | The same, through `@bridge-ds/core` (`explorations.ts`) |
| Previews: docs, Storybook, admin demo built from the branch | Vercel, `previews.apps` in `bridge.config.json` ([PREVIEWS.md](PREVIEWS.md)) |
| Snapshot packages a product staging branch installs | `.github/workflows/preview-packages.yml`, on every push to the draft |
| Guard: the check "Exploration not merged as is" fails while the label is on | `.github/workflows/exploration-guard.yml` |

## When to use one

- **Coded prototype for a user test.** Build the screens in the product with the real components and an
  experimental variant (a pill button, denser tables), install the exploration snapshot on a staging branch, and
  test with users there. Production keeps the released version.
- **Stakeholder demo.** Show an idea on real screens before anyone commits to it: the docs and Storybook previews
  and the product staging link are enough, nobody reviews a pull request yet.
- **A/B idea.** Ship the variant to a staging or experiment branch of the product, compare it with what is live,
  then promote the winner or close the exploration.
- **A designer exploring from the terminal.** With Claude Code and the Bridge MCP server, a designer works on
  `explore/<name>` instead of `main`: token edits, docs drafts and component requests all target that branch.

## Start one

In **Bridge Studio**, Changes, Explorations, **Start an exploration**: a name and what you want to learn. Bridge
creates the branch from `main` with the exploration note and opens the draft pull request (it needs a GitHub
token with contents and pull requests write: Connect GitHub).

From a terminal:

```sh
bridge explore start "Pill buttons" --purpose "Do rounder buttons feel friendlier in checkout?" --use-case user-test
bridge explore start "Pill buttons" --purpose "..." --dry-run      # the branch, note and pull request body, nothing written
```

With a GitHub token (`GITHUB_TOKEN`, `BRIDGE_GITHUB_TOKEN` or `gh auth login`) the branch and the draft pull request
are created on GitHub. Without one, in a git repo, Bridge creates the local branch only and prints the commands to
push it and open the draft (`gh pr create --draft --label exploration`). Use cases: `user-test`,
`stakeholder-demo`, `ab-idea`, `terminal`, `other`.

With Claude: "Start an exploration called Pill buttons to test rounder buttons in checkout." Claude calls
`bridge_start_exploration`.

## Try it in a product staging branch

Every push to the exploration publishes the design system packages (see [PREVIEWS.md](PREVIEWS.md) for the one-time
setup). The sticky comment "Try this exploration in your product" (`<!-- bridge-branch-preview -->`) gives the command
that works for the latest commit: pkg.pr.new when its app is installed, otherwise the prerelease tarballs. The DS Bridge
plugin and Studio read the command from that comment (`installCommandFromPreviewComment` in `@bridge-ds/core`) and never
guess one: until the comment matches the latest commit they say the test build is being prepared. `bridge explore list`
and `bridge_list_explorations` read it the same way (`install.state` is `building` until then). In the product repo,
on a branch that deploys to staging:

```sh
npm i @bridge-ds/tokens@<snapshot> @bridge-ds/core@<snapshot> @bridge-ds/react@<snapshot>
# with pkg.pr.new, <snapshot> is the URL of the latest commit of pull request 12:
npm i @bridge-ds/tokens@https://pkg.pr.new/peterbono/ai-design-system-demo/@bridge-ds/tokens@12 \
      @bridge-ds/core@https://pkg.pr.new/peterbono/ai-design-system-demo/@bridge-ds/core@12 \
      @bridge-ds/react@https://pkg.pr.new/peterbono/ai-design-system-demo/@bridge-ds/react@12
```

`name@url` keeps the package names in the product's `package.json`, so imports do not change. Install the
packages together so internal dependencies resolve to the same snapshot. Swap the pull request number for a commit
sha to pin one commit.

**Fallback, URL tarballs.** When the pkg.pr.new app is not installed, the workflow attaches `npm pack` tarballs to
the `preview-pr-<n>` GitHub prerelease (latest commit only, removed when the pull request closes):

```sh
npm i @bridge-ds/react@https://github.com/peterbono/ai-design-system-demo/releases/download/preview-pr-12/bridge-ds-react-<sha7>.tgz
```

The comment lists the exact URLs. **Tokens only, no reinstall:** open the staging with
`?bridge-tokens=<docs preview>/tokens.css` ([PREVIEWS.md](PREVIEWS.md)).

## Work on it

Everything that writes takes the exploration branch instead of opening a pull request to `main`:

| Change | Studio or terminal | Claude (MCP) |
| --- | --- | --- |
| Token edits | `git switch explore/<name>`, then `bridge propose --branch explore/<name> --title "..." --set path=value` | `bridge_propose_token_change` with `"branch": "explore/<name>"` |
| Component work | A request with `--exploration explore/<name>` (labeled `exploration`), then `bridge request implement <n> --branch explore/<name>` | `bridge_create_request` with `exploration`, `bridge_get_request` with `branch` |
| Docs drafts | `bridge docs draft <Component>` on the checked-out branch | `bridge_draft_docs` with `branch` |

From Figma, the DS Bridge plugin's Push has **Try in an exploration** next to Send for review: pick a running
exploration (or start a new one with a name and a purpose), and the checked variable edits become one commit on
`explore/<name>` (no pull request to main). An exact token change on a component (a component token pointing to
another variable) is committed there too, through the same contrast gate as for review; component changes that need
code become requests labeled `exploration`. Items marked "Exploration only" start checked there.

Explorations are tried locally: Vercel does not deploy `explore/**` (nor `bridge/**`, `agent/**`, `test/**`), to
stay under the free plan's daily limit. After sending, the main action is **See it in Studio**: the exploration's
page shows the Visual impact screenshots (every brand and theme, before and after) once the token change is on the
branch. **Share with a developer** copies a message with `git fetch origin && git switch explore/<name>`, the
install command for a product staging branch when the test build is ready, and the pull request. A repository that
does deploy previews keeps the preview links: they show as soon as Vercel reports them (see [PREVIEWS.md](PREVIEWS.md)).

On GitHub (`--repo` mode with a token), token edits are one commit on the exploration branch. Locally, the branch
must be checked out: Bridge writes the files to that working tree and you commit and push them. A request brief for
an exploration says: work on that branch, commit there, never open a pull request to `main`, never mark it ready
for review.

## Promote or close

- **Promote to review** (Studio, or `bridge explore promote <name>`): Bridge removes the exploration note from the
  branch, adds the tier labels from the shared classifier (`classifyRisk`, the same as every other change), removes
  the `exploration` label, rewrites the body for review (it keeps the purpose and closes the requests implemented on
  the exploration), and marks the draft ready for review. GitHub's REST API cannot unset `draft`, so Bridge uses the
  GraphQL mutation `markPullRequestReadyForReview` with the same token; when the token cannot, it says so and you
  press **Ready for review** on GitHub. Then the pull request goes through the usual tiers and gates. Bridge never
  merges.
- **Close** (Studio, `bridge explore close <name>`, or close the pull request on GitHub): the branch stays for
  reference; the preview prerelease is removed.

```sh
bridge explore list                    # running and promoted ones: previews, install command, linked requests
bridge explore promote pill-buttons --dry-run
bridge explore promote pill-buttons
bridge explore close pill-buttons
```

Statuses everywhere (Studio, CLI, MCP): **running** (open, labeled `exploration`), **promoted to review** (the label
is gone: it is a normal pull request), **closed** (closed without merging).

## Guardrails

- **Not mergeable as is.** The CI job **Exploration not merged as is** fails while the `exploration` label is on,
  so an exploration can never be merged by accident (owners merge green pull requests only). Studio shows the tier
  as **Exploration (not mergeable)** and blocks the merge until it is promoted.
- **Never `main`.** Explorations are branches with a draft pull request; the protected branches and the base branch
  are refused by the same guard as every other Bridge write.
- **Same review after promotion.** A promoted exploration gets its tier from the files it changes: a token edit is
  Tier 3 (design and tech owner approval), a component change Tier 2, docs Tier 1 ([GOVERNANCE.md](GOVERNANCE.md)).
