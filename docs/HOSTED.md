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
3. Push. Each push to the default branch publishes the snapshot to the orphan branch `bridge-data`.

The workflow uses only the run's `GITHUB_TOKEN`, with `contents: write` to push that branch. There is no secret to
add. The branch is never merged; delete it to start over. This repository runs its own copy,
[`.github/workflows/bridge-data.yml`](../.github/workflows/bridge-data.yml), with the local build of the CLI. It
follows the `bridge-visual` branch of the visual impact workflow.

### What is on the branch

```
bridge-data
  snapshot.json        the snapshot (read by hosted Studio and Library)
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

### Run it locally

```sh
bridge snapshot                                      # writes bridge-data/snapshot.json
bridge snapshot --out /tmp/bd --audit "apps/web/src=Web app" --audit-report reports/
bridge snapshot --json                               # summary as JSON
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
the Bridge domain. A team that wants its Library indexed opts in, on a public repository only:

```json
{ "library": { "public": true } }
```

The page adds the `noindex` tag first and removes it once it has read this setting.

**Routing.** Each page is built once, without team data, at `/library-shell/<route>`; `vercel.json` rewrites
`/library/<owner>/<repo>/...` to it (two rules, the trailing slash one first). Bridge's own Library home stays at
`/library/`, and the build fails if a file would ever take a `/library/<owner>/<repo>/` address.
`node scripts/hosted-smoke.mjs <deployment>` checks the routes on a deployment.
