# Explorations

Try experimental variables and components in a real product staging branch, without touching `main`.

An **exploration** is a branch named `explore/<name>` with an open **draft** pull request labeled `exploration`. It
holds token edits and component work, gets the same per-branch previews and snapshot packages as any pull request,
and is **never merged as is**. It is a living prototype that the designer, the DS lead, stakeholders and developers
keep coming back to, so it is never closed: when the idea is ready the designer says **Done exploring** and the
developers take the branch from there; an exploration nobody needs any more is **archived**, its link still alive.

| What | Where it comes from |
| --- | --- |
| Branch `explore/<name>` from `main`, first commit `.bridge/explorations/<name>.md` (the purpose) | Studio, `bridge explore start`, or Claude (`bridge_start_exploration`) |
| Draft pull request "Exploration: ...", labeled `exploration`, body with purpose, where the install command is, previews, done exploring and archive | The same, through `@bridge-ds/core` (`explorations.ts`) |
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
  then say done exploring on the winner and archive the others.
- **A designer exploring from the terminal.** With Claude Code and the Bridge MCP server, a designer works on
  `explore/<name>` instead of `main`: token edits, docs drafts and component requests all target that branch.

## Start one

In **Bridge Studio**, Changes, Explorations, **Start an exploration**: a name, and what you want to learn if you
want to say it (optional, nobody needs a brief to explore). Bridge creates the branch from `main` with the
exploration note and opens the draft pull request (it needs a GitHub token with contents and pull requests write:
Connect GitHub).

**Where it is created.** An exploration for a product that has its own repository (`bridge.config.json`
`products[].repo`) is created **in that product repository** by default: `explore/<name>` from its default branch and
the draft pull request there, so developers check the branch out in their usual environment. The library arrives as
the npm package, as on main; to try library changes that are not released yet, install the snapshot of their library
branch (`npm i @bridge-ds/react@<snapshot>`, below). A product that is a folder of the design system repository (the
Admin demo) and the demo workspace keep their explorations in the design system repository. Here, the Demo shop
(`shop`, [peterbono/bridge-demo-shop](https://github.com/peterbono/bridge-demo-shop)) is a product with its own
repository: its explorations are `explore/*` branches there, each with a Vercel preview. When Bridge cannot reach
the product repository (Bridge not installed on it, or no write access), Studio's "Create branch" says so in one
line with **Ask an admin to connect <product>** (it copies a message for an admin) and starts it in the design system
repository only if the person picks **Start in the library instead**. Claude gets the same error and asks before
using `where: "library"`; the CLI takes `--in-library`.

From a terminal:

```sh
bridge explore start "Pill buttons"                                  # the purpose is optional
bridge explore start "Pill buttons" --purpose "Do rounder buttons feel friendlier in checkout?" --use-case user-test
bridge explore start "Billing screen" --product shop                 # in the shop repository when it has one
bridge explore start "Pill buttons" --purpose "..." --dry-run      # the branch, note and pull request body, nothing written
```

With a GitHub token (`GITHUB_TOKEN`, `BRIDGE_GITHUB_TOKEN` or `gh auth login`) the branch and the draft pull request
are created on GitHub. Without one, in a git repo, Bridge creates the local branch only and prints the commands to
push it and open the draft (`gh pr create --draft --label exploration`). Use cases: `user-test`,
`stakeholder-demo`, `ab-idea`, `terminal`, `other`.

With Claude: "I want to explore pill buttons in checkout." Claude calls `bridge_start_exploration` right away, named
from what you said, without asking for a purpose or a brief.

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

Explorations are tried in their previews: Vercel deploys `explore/**` (docs, Storybook, admin demo), and **Try it**
lists each preview link as soon as Vercel reports it (see [PREVIEWS.md](PREVIEWS.md)). Next to it, **See it in
Studio** opens the exploration's page with the Visual impact screenshots (every brand and theme, before and after)
once the token change is on the branch. **Share with a developer** copies a message with the preview links, the
install command for a product staging branch when the test build is ready, and the pull request. When no preview is
reported (a repository without previews, or a deploy that did not run), Try it says so and the message gives
`git fetch origin && git switch explore/<name>` instead, to open it on a developer's machine.

On GitHub (`--repo` mode with a token), token edits are one commit on the exploration branch. Locally, the branch
must be checked out: Bridge writes the files to that working tree and you commit and push them. A request brief for
an exploration says: work on that branch, commit there, never open a pull request to `main`, never mark it ready
for review.

### Pick it up where you left off

The exploration's page in Studio says where it stands. **Not started** while the branch only carries the Bridge
note: "Nothing built yet", the line to paste in Claude (Claude app or Terminal) and **Continue in Claude**, which
copies it. **Exploring** once something changed: who changed what and when (the files named as screens and
components, else the commit subject), the preview, **Done exploring** in the "Happy with it?" card and the last
three events.

The line reads `Continue Bridge exploration #12 "Name" in Admin demo and use the Bridge library.`, or
`claude "Continue Bridge exploration #12"` in a terminal (`shop#12` for a product with its own repository). Claude
resolves it with `bridge_continue_exploration` (`bridge explore continue #12` in the CLI): it switches a clean
checkout of the right repository to the branch, then starts by saying where it stands. At the start of a session,
Claude mentions your running explorations once (`bridge_list_explorations` with `mine: true`) and offers to continue
one.

## Done exploring, archive

- **Done exploring** (Studio, `bridge explore done <name>`, Claude `bridge_promote_exploration`; `bridge explore
  promote` is the old name and does the same): Bridge lists the new pieces the last check found (`bridge pieces <n>
  --record`, `bridge_missing_pieces`): a new token near the closest one, a variant such as "Badge: overdue tone", a
  library component restyled with tokens only (CSS on a class it carries or on a state such as `[aria-pressed]`:
  "IconButton: restyled when pressed"; layout around it is not a piece), a new component. When none is picked, or the
  exploration was never checked, Bridge says so. Each piece the designer ticks becomes a request for the DS lead (an issue labeled
  `component-change` and `needed-by-product`, with the "Needed by" block and a link to the exploration's preview);
  unticked pieces are not proposed. Then Bridge removes the exploration note from the branch, swaps the
  `exploration` label for `ready-for-devs`, and rewrites the body with a **For developers** section. Nothing is
  closed, merged or marked ready for review: the pull request stays open, so its preview link keeps working. Said
  again later, it only sends the newly ticked pieces.
- **For developers**: `git fetch origin` then `git checkout explore/<name>`. It is a **starting point**: nobody has
  reviewed Claude's prototype code yet, and the note says what the branch checks did (they pass, fail, still run, or
  none ran), never "ready to ship". Developers continue on that branch; its pull request
  already exists, so Bridge follows the pushes and the merge. Studio keeps this in a folded "For developers" section,
  never in the designer's flow.
- **Archive** (Studio, `bridge explore archive|unarchive <name>`, `bridge_archive_exploration`): the `archived` label
  on the still open pull request hides it from the default lists, the home and the counts. Changes lists it under
  "N archived explorations. Show them" (`?archived=1`), `bridge explore list --archived` too. Do not close an
  exploration: closing a pull request removes its preview prerelease and its visual images.
- **Close** (`bridge explore close <name>`, or on GitHub) still exists for when someone explicitly wants it gone.

```sh
bridge pieces 12 --record                      # find what the library lacks
bridge explore done pill-buttons --piece badge-overdue-tone --dry-run
bridge explore done pill-buttons --piece badge-overdue-tone
bridge explore archive pill-buttons
bridge explore list --archived
```

### In a product's own repository

An exploration created in a product repository (`products[].repo`) lives there for good, and Bridge follows it there:

- **Lists.** Studio (Changes, the home, Being built), `bridge explore list` and `bridge_list_explorations` read the
  open `explore/*` pull requests of each product repository too: one read per repository, cached like the design
  system's list, through the same GitHub sign-in or Bridge's proxy (for email members and demo visitors, read only).
  They show under their product. A product repository Bridge cannot read is left out of the lists without a word;
  Settings, `bridge products` and `bridge_list_products` (`connection`) say which one is not connected.
- **Naming it.** Studio opens it at `changes/?exploration=<n>&product=<key>`. The CLI and Claude name it
  `<product>#<n>` (`shop#12`), `owner/name#12` or its pull request link; a plain name (`checkout-flow`) is looked up
  in the design system repository first, then in each product repository.
- **Missing pieces** (`bridge pieces shop#12 --record`, `bridge_missing_pieces`, the Studio pieces dialog) read the
  product branch where it lives; every product file counts, since `path` is a folder of the design system repository.
- **Done exploring** files the requests in the **design system repository**, where the DS lead works. Each one links
  back to the product pull request (`owner/name#12`, which GitHub links across repositories) and to its preview (the
  product's `preview` template). The product pull request records them as `owner/ds#n`, so a piece is never sent
  twice. Labels, the note and the **For developers** section change on the product pull request, as for any
  exploration; Archive works there too.
- **Status** follows the product pull request: pushes read Being built, the merge reads Shipped.
- A library branch cannot be merged into a branch of another repository: `bridge pieces preview|switch` say so. Try an
  unreleased library change with its snapshot (`npm i @bridge-ds/react@<snapshot>`), then bump the package once it
  ships.

```sh
bridge explore list                            # shop#12 Checkout flow  Running  explore/checkout-flow in acme/shop
bridge pieces shop#12 --record
bridge explore done shop#12 --piece badge-overdue-tone
bridge products                                # shop  Shop  acme/shop (connected)
```

Statuses everywhere (Studio, CLI, MCP): **Running** (open, labeled `exploration`), **Waiting for code** (done
exploring, labeled `ready-for-devs`, no new commit since), **Being built** (developers pushed to it or marked it
ready for review), **Shipped** (merged after done exploring), **Closed** (closed without merging). An exploration
promoted to review before 2026-10-30 still reads **Promoted to review**.

## Guardrails

- **Not mergeable as is.** The CI job **Exploration not merged as is** fails while the `exploration` label is on,
  so an exploration can never be merged by accident (owners merge green pull requests only). Studio shows the tier
  as **Exploration (not mergeable)** and blocks the merge until someone says it is done exploring.
- **Never `main`.** Explorations are branches with a draft pull request; the protected branches and the base branch
  are refused by the same guard as every other Bridge write.
- **Same review once developers mark it ready.** It gets its tier from the files it changes: a token edit is
  Tier 3 (design and tech owner approval), a component change Tier 2, docs Tier 1 ([GOVERNANCE.md](GOVERNANCE.md)).
