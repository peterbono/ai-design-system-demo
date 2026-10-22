# Hosted Bridge

One Bridge site serves any team's design system repository at `/studio/<owner>/<repo>/`. Joining a team means
opening that link and signing in with GitHub: GitHub repository permissions decide what each person can do, and roles
stay in the repository's `bridge.config.json`. Bridge keeps no accounts and no database.

This page grows with the hosted mode. It covers the snapshot a team can publish for it, and the team's hosted Library.

## The snapshot: the `bridge-data` branch

Bridge reads a team's repository live from GitHub in the browser. A team can also publish a **snapshot** from its CI.
It is optional, and once hosted Studio and Library read it (they are being built on it), it helps in three ways:

- Pages open with one request to `raw.githubusercontent.com` instead of one per file, and visitors spend none of
  their GitHub API quota (anonymous visitors have 60 requests an hour).
- It carries what only Node can compute: **adoption audits** of the apps that use the design system
  (`bridge audit`), which the browser cannot run on another repository.
- It carries the **Figma coverage** compactly. `component-specs.json` is over 1 MB in this repository, above what
  the live GitHub source reads; the snapshot keeps its coverage list (a few KB) and leaves the specs out.

Bridge reads the snapshot only when it is fresh: its `sourceSha` equals the head of the default branch. Otherwise it
reads the repository live, so a late or failed workflow never shows stale data.

### Set it up

1. Copy [`templates/bridge-data.yml`](../templates/bridge-data.yml) to `.github/workflows/bridge-data.yml` in your
   design system repository. If your default branch is not `main`, change the `push` branch.
2. Optional: add one `--audit "<folder>=<label>"` per app folder in the repository that uses the design system.
3. Push. Each push to the default branch publishes the snapshot to the orphan branch `bridge-data`. Pull request,
   issue and comment events and a run every 30 minutes keep `activity.json` fresh (see below).

The workflow uses only the run's `GITHUB_TOKEN`, with `contents: write` to push that branch and read access to pull
requests, issues, checks and statuses. There is no secret to add. Runs queue in one concurrency group. The branch holds
one commit with the latest files, replaced on every run; it is never merged; delete it to start over. This repository runs its own copy,
[`.github/workflows/bridge-data.yml`](../.github/workflows/bridge-data.yml), with the local build of the CLI. It
follows the `bridge-visual` branch of the visual impact workflow.

### What is on the branch

```
bridge-data
  snapshot.json        the snapshot (read by hosted Studio and Library)
  activity.json        the team's work in progress, for visitors who are not signed in (--activity)
  llms.txt             the design system as plain text for AI agents (tokens, components, usage guidance)
  audits/<id>.json     one adoption report per audit, in the `bridge audit --json` format
  README.md
```

`snapshot.json` (`kind: "bridge-snapshot"`, `schemaVersion: 1`):

| Key | What it holds |
| --- | --- |
| `repo`, `sourceSha`, `committedAt` | The repository, its default branch and the commit the snapshot was computed from |
| `files` | Bodies of the files the repo model reads: `bridge.config.json`, token files, the contrast checks, token usage notes, and per component the `.tsx`, stylesheet, stories and `docs.json`, plus the components barrel |
| `paths` | Every path listed under `tokens.root` and `components.dir`, so a folder reads as it is in the repository |
| `figma` | `{ path, coverage }` from `component-specs.json` (which components are in Figma), without the specs |
| `summary` | Counts for a header: tokens, components, contrast checks and failures, components in Figma |
| `contrast` | Contrast results per brand and theme, as computed for this commit |
| `audits` | One summary per adoption audit (`id`, `label`, `target`, `metrics`) and the `path` of its full report |
| `problems` | What could not be read (an invalid config, a `docs.json` that does not parse) |

Nothing else of the repository is copied. In code, `snapshotSource(parseSnapshot(text))` from `@bridge-ds/core` is a
`RepoSource`, so `loadRepoModel` gives the same model from the snapshot as from the repository (the full Figma
specs aside).

### Activity: `activity.json`, for visitors who are not signed in

GitHub gives a visitor who is not signed in 60 API requests an hour. A busy team's Branches page alone used to take
about 20, so a guest ran out after three page views. `bridge snapshot --activity` reads, in CI with the run's
`GITHUB_TOKEN`, what the guest pages read, and writes it to `activity.json`. A guest's Home, Branches, a branch
page, Review, History, a suggestion and a request then make no GitHub API request at all.

`activity.json` (`kind: "bridge-activity"`, `schemaVersion: 1`):

| Key | What it holds |
| --- | --- |
| `generatedAt`, `repo`, `headSha` | When it was written, the repository and its default branch head |
| `branches` | Open pull requests: title, author, labels, risk tier, state, comment count, changed token files, previews, checks |
| `suggestions` | Open suggestions with their parsed payload, status and approvers |
| `requests` | Component change requests with their kind, component and status |
| `merged` | Recently merged pull requests |
| `history` | The token history report of the default branch (what History shows) |
| `responses` | The GitHub REST reads (GET) the guest pages make, as GitHub answered them, trimmed: no API links, no diffs, trees cut to token, config and changeset files |
| `truncated`, `problems` | What was left out to stay small, and what could not be read |

Limits: the 30 most recently updated open branches with their pages, 30 suggestions, 30 requests, 20 merges, 20
history entries; above 3 MB the recorded trees go first, then the pages of the oldest branches. While the default
branch has not moved, the token history and the page of every branch nobody touched are kept from the last published
file (checks and statuses are read again), so a scheduled run costs about two requests per open branch of the
token's 1,000 an hour.

How Studio reads it: signed out, every GitHub GET is answered from `responses` first while `activity.json` is less than
a day old (`activityAnswer` in `@bridge-ds/core`), so every view keeps one code path. What it did not record is read
live. When GitHub refuses a read for the hourly limit, an older `activity.json` answers too. The guest banner says
how recent it is ("Updated 5 min ago"). Signed in, everything is read live. Without `activity.json`, a guest's reads
are still shared: the same read in flight goes out once, and an answer from the last two minutes is reused in the
tab.

### Run it locally

```sh
bridge snapshot                                      # writes bridge-data/snapshot.json
bridge snapshot --out /tmp/bd --audit "apps/web/src=Web app" --audit-report reports/
bridge snapshot --json                               # summary as JSON
GITHUB_TOKEN=... bridge snapshot --activity --repo acme/ds   # also activity.json, read from GitHub
```

`--audit <folder>[=label]` runs `bridge audit` on a folder of this repository. `--audit-report <file|folder>` carries
reports already written by `bridge audit --json`. Paths are relative to the repository root (`--root`). The command
refuses a snapshot over 5 MB: check `tokens.root` and `components.dir` in `bridge.config.json`.

### Private repositories

The branch has the repository's visibility. A private repository's snapshot is read through the GitHub contents API
with the visitor's token, like the rest of the repository; only people with access can read it.

## The hosted Library: `/library/<owner>/<repo>/`

Every team gets a Library, the published side of its design system, for everyone who uses it rather than maintains
it. Four pages, the same on every team:

| Page | What it shows |
| --- | --- |
| Home | What the design system holds, the three places below, and the team's `llms.txt` for AI agents |
| Foundations | Color, type, space, radius and shadow, drawn from the resolved tokens (never the team's components) |
| Components | Every component by family; one component at `components/?c=<slug>` with a live story from the team's Storybook and its `docs.json` guidance |
| Tokens | Every token, semantic first, with its value per theme and its CSS variable |

**Where the data comes from.** Signed out, the Library reads the published snapshot straight from
`raw.githubusercontent.com`: no GitHub API call at all, so anonymous readers never hit GitHub's 60 requests an hour.
A team without a snapshot is read live (public repositories only). Signed in (the same sign-in as the team's Studio),
it reads like Studio: the snapshot when it matches the default branch head, else the repository itself. A private
repository's Library needs a sign-in with access.

**Search engines.** Every team Library page is `noindex` by default: it shows content Bridge does not control under
the Bridge domain. Two locks keep it that way, and a Library is indexed only when both open:

1. **The server.** Every `/library/<owner>/<repo>/...` address answers `X-Robots-Tag: noindex` (a `vercel.json`
   header, so crawlers that never run JavaScript see it too), and so does every `/library-shell/...` page. The only
   exceptions are the teams listed in [`apps/docs-site/hosted/public-libraries.json`](../apps/docs-site/hosted/public-libraries.json),
   a committed allow-list that changes by pull request, reviewed by Bridge maintainers. There is no database, so the
   list is the record of who opted in.
2. **The team.** Its repository is public and its `bridge.config.json` says:

   ```json
   { "library": { "public": true } }
   ```

   The page adds a `noindex` tag first and removes it once it has read this setting, so a listed team that turns the
   setting off (or makes its repository private) is out of the index again without a Bridge change.

To list a team: add `"owner/repo"` to `libraries` in the allow-list, then build. The build fails until `vercel.json`
carries the matching rules and prints them to paste: the listed pairs are excluded by a lookahead on the owner group
of the two Library noindex rules (`/library/:owner((?!(?:acme/ds)(?:/|$))...)/:repo(...)/:path*/` and the form
without the trailing slash). `library-shells.test.ts` checks the same thing in CI. Vercel matches header rules on the
address requested, before the rewrite, so the shell's own rule never reaches a team address.

**Routing.** Each page is built once, without team data, at `/library-shell/<route>`; `vercel.json` rewrites
`/library/<owner>/<repo>/...` to it (two rules, the trailing slash one first). Bridge's own Library home stays at
`/library/`, and the build fails if a file would ever take a `/library/<owner>/<repo>/` address.
`node scripts/hosted-smoke.mjs <deployment>` checks the routes on a deployment, and the `X-Robots-Tag` of each team
Library against the allow-list (on production only: Vercel marks every preview response `noindex`).
