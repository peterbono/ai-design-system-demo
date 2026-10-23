# Hosted Bridge

One Bridge site serves any team's design system repository at `/studio/<owner>/<repo>/`. Joining a team means
opening that link and signing in with GitHub: GitHub repository permissions decide what each person can do, and roles
stay in the repository's `bridge.config.json`. Bridge keeps no accounts. Its one store holds pending invites by
email (see "Invites by email" below), each team's Library access setting and short-lived Library sign-in links (see
"Library access" below), and nothing else.

This page grows with the hosted mode. It covers the snapshot a team can publish for it, the team's hosted Library,
invites by email, and who reads a team's Library without a GitHub account.

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

## Invites by email

An admin invites people from Studio (the team menu, or Settings, Members): work emails and a role. Bridge emails each
person a link; they open it, sign in with GitHub, and Bridge gives their GitHub account access to the repository with
that role. A "Can edit" invite can also be accepted with the email alone, no GitHub account: see "Email
contributors". Admins also change roles, remove people, and resend or cancel invites there. The server piece is one Vercel
function, `apps/docs-site/api/invites/index.ts`.

### Roles

| Role in Studio | On GitHub                  | In `bridge.config.json`                                              |
| -------------- | -------------------------- | -------------------------------------------------------------------- |
| Can view       | `pull` (read)              | nothing. No longer offered: readers use Library access (below)       |
| Can edit       | `push` (write), or none when they join with their email (Email contributors) | nothing    |
| Reviewer       | `push` (write)             | added to `governance.owners.design` (Designer) or `.tech` (Developer) |
| Admin          | `admin`                    | owner lists left as they are                                         |

Invites are for contributors: Studio offers Can edit, Reviewer and Admin, and the server refuses Can view for a new
invite or a role change. People who only read the design system need no GitHub account: see "Library access". A member
or a pending invite that already has Can view keeps it, shows it, and can be moved to a contributor role.

Owners live in `bridge.config.json`, a guardrail file, so a reviewer is listed through a pull request on it (the same
keys Settings edits), opened by the Bridge Direct app. The reviewer role applies once it is merged. A repository owned
by a personal GitHub account has no per-person permissions: every collaborator can push and only the owner is admin,
so Can view and Admin cannot be enforced there.

### How it works, and what it keeps

- **Pending invites** (email, role, team, who invited, created, sent and expiry dates, the SHA-256 of the link
  token, nothing else) are stored in an Upstash Redis database, never in the browser. Each record and its link index
  expire in Redis with the invite (7 days), and are deleted at once when the invite is accepted or cancelled. The
  link token itself is only in the email, in the link's fragment (`/studio/invite/#t=...`), so it reaches no server
  log. A link works once; Resend makes a new one and the old one stops working. Per link, its team and the inviter's
  name (no email) stay 30 days after the invite expires, so an old link says whom to ask for a new one, and a member
  who opens it again gets "You're already in <team>". The function logs nothing.
- **One identity.** The link opens the one sign-in screen of Bridge: signed out, it sends the code to the invited
  address (shown masked, never in full: `POST /api/account { action: 'code', invite: <token> }`), asks the name of a
  new account once, then shows the invite (Entry E3) and joins with the Bridge account. Signed in as another email, it
  says where the invite went with "Sign in as that email". The invite page reads the link with
  `POST /api/entry { action: 'invite-link', token }`, the one entry call without a session, 30 per network an hour.
- **Only the invited person joins.** On accept, the GitHub account must have the invited email as a **verified**
  email (read with the invitee's own sign-in, `GET /user/emails`, compared trimmed and case-insensitive). Otherwise
  nothing is granted, the invite stays valid, and the page says which address it was sent to, masked
  (`m•••@acme.design`), and how to fix it: add and verify that email on GitHub, or ask the admin to invite the address
  they use on GitHub. This needs the account permission **Email addresses: Read-only** on the GitHub Apps people sign
  in with (docs/SIGN-IN.md). A sign-in from before that permission was added cannot read emails: the page asks to
  sign in with GitHub again, which shows GitHub's consent for the new permission.
- **Who acts on GitHub.** The invitee accepts after the admin is gone, so the admin's own sign-in cannot add them, and
  Bridge does not store anyone's personal token for later. The function mints a short-lived installation token of the
  Bridge Direct app for the one repository on each request, and never stores it.
- **Every call is checked on GitHub.** The caller is identified with their own GitHub sign-in (`GET /user`), and
  their role on the repository is read again with the app on every request: only admins invite, change roles, remove,
  resend or cancel; people who can push see the pending invites.
- **Organization members** Bridge already knows (picked from the suggestions) are added straight away, without an
  email.
- When GitHub sends an invitation instead of adding the person (someone outside the organization), Bridge accepts it
  for them when GitHub allows it, else the invite page sends them to accept it on GitHub in one click.
- Without storage, email or the app configured, every action answers "Invites are not available yet on this site."
  and Studio says so. Nothing pretends to work.

### Caps

Every email sent (an invite or a resend) counts toward three daily counters in Redis, which expire on their own after
two days. A day is a UTC day. A request over a cap sends nothing and answers HTTP 429 with the reason and a
`Retry-After` header; Studio shows the sentence ("You reached today's invite limit. Try again tomorrow."). A batch
larger than what is left is refused whole, with how many can still go out today.

| Cap                               | Default | Env override                 |
| --------------------------------- | ------- | ---------------------------- |
| Emails per admin per day          | 20      | `INVITES_MAX_PER_ADMIN_DAY`  |
| Emails per team per day           | 40      | `INVITES_MAX_PER_TEAM_DAY`   |
| Emails for the whole site per day | 80      | `INVITES_MAX_SITE_DAY`       |
| Pause between two sends of one invite | 10 minutes | none                    |
| Resends of one invite per day     | 3       | none                         |
| People per request                | 10      | none                         |

Keep `INVITES_MAX_SITE_DAY` below the daily sending quota of your Resend plan (check it on your Resend account), so
invites never fail at the provider. The overrides are whole numbers; `0` stops sending; anything else falls back to
the default. Emails are validated on the server before anything is counted, and only emails that actually went out
count (organization members added directly, addresses already invited and failed sends are given back).

### Set it up (owner of the site)

1. **Storage.** In the Vercel project (`bridge-docs`): **Storage**, **Create Database**, **Upstash for Redis** (Vercel
   Marketplace), connect it to the project for Production and Preview. It adds `KV_REST_API_URL` and
   `KV_REST_API_TOKEN` (the function also reads `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`).
2. **Email.** Create a [Resend](https://resend.com) account, verify a sending domain (for example
   `bridge.floriangouloubi.com`, with the DNS records Resend lists), create an API key with sending access.
3. **The app's private key.** On the Bridge Direct app's settings page (docs/SIGN-IN.md): note its **App ID**, then
   **Private keys**, **Generate a private key** (a `.pem` file). Check its permissions include Repository
   **Administration: Read and write** (already in the list), **Contents** and **Pull requests: Read and write** (for
   the reviewer pull request), and for organization repositories **Organization, Members: Read only**. Each
   installation must accept a permission GitHub added since it was installed. On **both** apps (Bridge and Bridge
   Direct), add the account permission **Email addresses: Read-only**, so the invite page can check the invited email
   belongs to the person who accepts. People already signed in get it when they sign in again (the invite page asks
   them to).
4. **Environment variables** on Vercel, Production and Preview, all **Sensitive**:

| Name                     | Value                                                                    |
| ------------------------ | ------------------------------------------------------------------------ |
| `KV_REST_API_URL`        | Added by step 1                                                          |
| `KV_REST_API_TOKEN`      | Added by step 1                                                          |
| `RESEND_API_KEY`         | The Resend API key                                                       |
| `INVITE_EMAIL_FROM`      | The sender, on the verified domain: `Bridge <invites@bridge.floriangouloubi.com>` |
| `GITHUB_APP_ID`          | Bridge Direct's App ID                                                   |
| `GITHUB_APP_PRIVATE_KEY` | The whole `.pem` content (line breaks or `\n` both work)                 |
| `PUBLIC_SITE_URL`        | Optional: the origin for links in emails, `https://bridge.floriangouloubi.com`. Default: the site the admin invited from |
| `INVITES_MAX_PER_ADMIN_DAY`, `INVITES_MAX_PER_TEAM_DAY`, `INVITES_MAX_SITE_DAY` | Optional: the daily caps (see Caps). Not sensitive |

5. Redeploy. `GET /api/invites` answers `{ "available": true }` once everything is set.


## Library access

A team's Library (`/library/<owner>/<repo>/`) is for the whole company, and most readers have no GitHub account. An
admin picks who reads it in Studio, Settings, Library access (everyone else on the team reads the choice), and copies
the library link from there to share it. The server piece is one Vercel function,
`apps/docs-site/api/library-access/index.ts`.

| Choice                          | Who reads the Library                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------------------ |
| Anyone with the link            | Everyone. The default for a public repository.                                                  |
| Anyone with a work email at ... | People with an email at one of the listed domains (for example `acme.design`): they enter it on the Library and open the link Bridge emails them. |
| Only the team                   | People with access to the repository on GitHub, signed in with GitHub. The default for a private repository. |

Contributors (Can edit, Reviewer, Admin) keep signing in with GitHub and are invited from Members.

### How it works, and what it keeps

- **The setting** is stored per team in the same Upstash Redis database as invites: the choice, the domains, a
  version number, whether GitHub said the repository is private, who changed it and when. Not in `bridge.config.json`:
  the server reads it on every Library visit without a GitHub API call, a change must apply at once (it ends every
  reader session), and a company's email domain does not belong in a public repository. Without a stored setting a
  team keeps the default above; if the store were lost, every team would fall back to it, which never opens more than
  GitHub does. Only a repository admin changes it, checked on GitHub with their own sign-in on every save.
- **The sign-in link.** On the Library, a reader enters their work email. The server checks the part after the `@`
  against the listed domains (exact match, case-insensitive: `eng.acme.design` matches only if it is listed itself),
  then emails a link `<site>/library/<owner>/<repo>/#signin=<token>`. The token is 32 random bytes in the fragment,
  so it reaches no server log. Only its SHA-256 is stored, with the team, the email's domain and the setting's version
  (never the email itself), for 15 minutes, and it works once. Consumer providers (`gmail.com`, `outlook.com`...) are
  refused as domains.
- **The session.** Opening the link sets one cookie per team, `bridge_library_<hash>`, `HttpOnly`, `Secure`,
  `SameSite=Lax`, `Path=/api/library-access` (only this function reads it), for 30 days. It carries the team, the
  email's domain, the setting's version and the expiry, signed with HMAC-SHA256 under `LIBRARY_SESSION_SECRET` and
  checked in constant time. Any change to the setting bumps its version and ends every session of that team at once.
- **Private repositories.** Once the session is checked, the function reads the team's published snapshot
  (`snapshot.json` and `llms.txt` on the `bridge-data` branch) with a Bridge Direct installation token limited to
  reading contents of that one repository, minted per request and never stored, and serves it. The browser never gets
  a GitHub token. A private team must publish the snapshot (see "The snapshot" above) for email readers to see it.
- **Public repositories** are still read by the browser from the raw host, with no GitHub API call, as before; a guest
  costs one call to this function for the setting. The files of a public repository stay readable on GitHub whatever
  the setting says, and Settings says so.
- The function logs nothing. Emails and IPs are counted under an HMAC, never kept in clear.
- Without storage, email, the secret or the app configured, `available` is false: Library pages behave as before (no
  gate), Settings says "Library access is not available yet on this site." and every action answers 503.

### Caps

Sign-in emails count toward four daily counters in Redis (UTC day, they expire after two days). Over a cap nothing is
sent: HTTP 429 with the reason and `Retry-After`, and the Library shows the sentence.

| Cap                               | Default | Env override                         |
| --------------------------------- | ------- | ------------------------------------ |
| Links per email per day           | 3       | `LIBRARY_SIGNIN_MAX_PER_EMAIL_DAY`   |
| Links per network (IP) per day    | 10      | `LIBRARY_SIGNIN_MAX_PER_IP_DAY`      |
| Links per team per day            | 20      | `LIBRARY_SIGNIN_MAX_PER_TEAM_DAY`    |
| Links for the whole site per day  | 20      | `LIBRARY_SIGNIN_MAX_SITE_DAY`        |

The site cap and `INVITES_MAX_SITE_DAY` (80) together stay under Resend's free daily quota (100). Raise both with
your Resend plan; a company rolling the Library out to many readers on one day needs a higher team and site cap.

### Set it up (owner of the site)

It reuses everything invites need (storage, Resend, the Bridge Direct app with Contents: Read), plus one secret:

| Name                     | Value                                                                    |
| ------------------------ | ------------------------------------------------------------------------ |
| `LIBRARY_SESSION_SECRET` | 32 characters or more, random (`openssl rand -base64 48`). Sensitive. Changing it signs every reader out |
| `LIBRARY_SIGNIN_MAX_PER_EMAIL_DAY`, `LIBRARY_SIGNIN_MAX_PER_IP_DAY`, `LIBRARY_SIGNIN_MAX_PER_TEAM_DAY`, `LIBRARY_SIGNIN_MAX_SITE_DAY` | Optional: the daily caps. Not sensitive |

Redeploy. `GET /api/library-access` answers `{ "available": true }` once everything is set.

### Later

Not built yet, with a place to plug in: company single sign-on (Google Workspace, Okta) is another way to prove a work
email, so it would end in the same session cookie (`issueSession` in the function). Comments and suggestions from email
readers would need the session to name the reader; today it only holds the email's domain.

## Email contributors

A designer invited with "Can edit" can join with their email only, no GitHub account. The invite link signs them in
to their Bridge account with a code sent to the invited address, then they join (Entry E3). Reviewers and admins see
the GitHub step before they join. Reviewers and
admins keep GitHub: they approve and merge. The server piece is one Vercel function,
`apps/docs-site/api/contribute/index.ts`; the pieces it shares with invites and Library access live in
`apps/docs-site/api/_lib/` (not a function).

### What Bridge does on their behalf

Their browser never gets a GitHub token. Studio sends its GitHub calls to
`/api/contribute?repo=<owner/repo>&gh=<path>`, and the function makes them with a Bridge Direct installation token
limited to that one repository and to Contents, Pull requests and Issues (read and write), minted on the server and
never stored. Commits carry the member as author (the app is the committer); pull requests and issues they open end
with "Requested by <name> (<email>) through Bridge." (no email on a public repository, see below); they only change
design files; their comments start with "**<name>** (via Bridge):". Branch protection and required reviews stay the
safety net: an email contributor can never approve, merge or write to the default branch.

### The policy

Deny by default: anything not listed answers 403 `not-allowed`, and only paths under `/repos/<the session's repo>`.

| Call                                   | Allowed when                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------------- |
| `GET` the read allow-list (below)      | always (read, read-only token, cached: see "Team reads through Bridge")         |
| `POST git/blobs`                       | always                                                                          |
| `POST git/trees`                       | every entry a design file (below); no submodule, symlink or executable          |
| `POST git/commits`                     | always; author set to the member (date kept), committer dropped                 |
| `POST git/refs`                        | `refs/heads/<b>`, `b` not the default branch and not existing, at a commit that changes design files only; `b` becomes theirs |
| `PATCH git/refs/heads/<b>`             | their branch, `force` false, to a commit that changes design files only         |
| `PUT` / `DELETE contents/<path>`       | a design file; `branch` given and theirs; author set to the member              |
| `POST pulls`                           | head is their branch, base the default branch or their branch; it becomes theirs |
| `PATCH pulls/<n>`                      | theirs; only `title`, `body`, `state`, `draft`; a new body keeps the "Requested by" line |
| `PUT pulls/<n>/update-branch`          | theirs                                                                          |
| `POST issues`                          | always; it becomes theirs                                                       |
| `PATCH issues/<n>`                     | theirs; only `title`, `body`, `state`, `labels`; a new body keeps the "Requested by" line |
| `POST issues/<n>/comments`             | any issue or pull request                                                       |
| `POST issues/<n>/labels`               | theirs                                                                          |

Never: merges, reviews, requested reviewers, rulesets, branch protection, collaborators, deleting a ref, hooks,
settings, another repository, GraphQL. "Theirs" means created through this function by the same member (Redis keeps
who created each branch, issue and pull request for a year, and per member the set
`bridge:contrib:mine:<repo>:<email>`). `GET /api/contribute?repo=<owner/repo>&mine=1` answers
`{ "branches": [...], "issues": [numbers] }` for the signed-in member (401 without a session), so Studio counts those
as theirs: GitHub shows Bridge's app as their author, and Studio writes the member back as author in what it reads. Paths with `.`/`..` segments, encoded slashes or
backslashes are refused. A request body is at most 5 MB.

**Design files only.** CI runs what a pull request contains, with the repository's secrets, so an email contributor
can only change design files: token files under `tokens.root`, component usage docs (`components.dir`, files ending
in `components.docsSuffix`), changesets (`changesets.dir` and `.changeset/`, `.md`) and Bridge's own files under
`.bridge/` (Figma specs, drafts, request images, exploration notes), read from `bridge.config.json` on the default
branch (cached 5 minutes); without the file, `tokens/`, `.changeset/` and `.bridge/`. Never code (`.js`, `.ts`, CSS,
YAML...), `.github/`, `scripts/`, `package.json` and lockfiles, tool configuration or dotfiles, the guardrails, or
`bridge.config.json` itself (so a new brand, which also edits it, needs a GitHub account). The check runs on every
written path and again on the content of any commit a branch is moved to (its changes from the default branch), so
a commit built elsewhere cannot slip in. Refused with "Bridge only saves design files (tokens, docs, assets) for
people who joined with their email. Ask a developer to change this file."

**Public repositories.** A work email is never published there: commits carry a stable address that routes nowhere,
`<12 hex>@contributors.bridge.invalid` (an HMAC of the team and the email), and the "Requested by" line names the
person without the email. Private repositories show the real email.

### Sessions, storage and caps

- **Members**: `bridge:member:<repo>:<email>` (email, name, role, version, who invited, when) and the set
  `bridge:members:<repo>`, in the same Upstash Redis as invites. Settings, Members lists them (marked as joined with
  email) and an admin removes them there; changing them to Reviewer or Admin answers `github-required`: invite them
  again with that role, and they join with GitHub (which drops the email membership).
- **The session**: one cookie per team, `bridge_contrib_<hash>`, `HttpOnly`, `Secure`, `SameSite=Lax`,
  `Path=/api/contribute`, 30 days, signed with HMAC-SHA256 under `LIBRARY_SESSION_SECRET` (with its own purpose, so a
  Library cookie never passes for it). Every request reads the member again: removed, or joined again since, and the
  session ends at once.
- **Invite links, before accepting**: `POST /api/invites { "action": "peek", "token" }` needs no sign-in and answers
  `{ "team", "repo", "role", "sentTo" }` (the address masked, never in full), 410 for a spent or unknown link, 30 per
  network an hour. The invite page itself reads `POST /api/entry { "action": "invite-link" }` (see "Invites by email").
- **Sign-in links**: `<site>/studio/<owner>/<repo>/#contribute=<token>`, only the token's SHA-256 stored, 15 minutes,
  once. The answer is the same whether or not the email is a member. Links count like Library sign-ins: 3 per email,
  10 per network, 20 per team and 20 for the site per day (emails and networks under an HMAC).
- **Writes**: every call other than `GET` counts toward a daily cap per member, `CONTRIB_MAX_WRITES` (300 by
  default; one saved change is a few calls). Over it: 429 `limit` until the next UTC day.
- **CSRF**: every call other than `GET` must carry `X-Bridge-Contribute: 1` (Studio sends it) and, when there is an
  `Origin`, come from a page of this site. The function logs nothing.

### Set it up (owner of the site)

It reuses what invites and Library access need: storage, Resend, `LIBRARY_SESSION_SECRET`, and the Bridge Direct app,
which must have **Contents**, **Pull requests** and **Issues: Read and write** on each installation (Issues is new if
the app was set up for invites only). Optional, not sensitive: `CONTRIB_MAX_WRITES`. Redeploy;
`GET /api/contribute?repo=<owner/repo>` answers `{ "available": true, "member": null }` once everything is set.

## Team reads through Bridge

Members of a team without a GitHub token of their own (email members, Bridge accounts) and signed-out visitors of the
public demo teams read the team's repository through Bridge, never with anonymous browser calls to `api.github.com`
(GitHub gives an address 60 of those an hour, about three page views). People signed in with GitHub keep reading with
their own token. The code is `apps/docs-site/api/_lib/team-read.ts`, wired in `/api/contribute` (its session cookie is
scoped there).

### The contract

| Request | Answer |
| ------- | ------ |
| `GET /api/contribute?repo=<owner/repo>&gh=<GitHub REST path, URL-encoded>` | GitHub's status, body, `Content-Type`, `Link` and `ETag`; `X-Bridge-Cache: hit`, `revalidated`, `miss` or `stale`; `304` when `If-None-Match` matches the kept `ETag` |
| `GET /api/contribute?repo=<owner/repo>&blobs=<sha>,<sha>,...` (1 to 100 full shas) | `{ "blobs": { "<sha>": "<text>" or null }, "later": ["<sha>"] }`: many file bodies at once (null: no such blob); `later` keeps one answer under 3 MB, ask again |

Studio uses the batch to load a design system in a few requests (core `RepoSource.prefetch`, `gitHubSource` `batch`)
instead of one request per file.

### Who, and what

- **Who**: a member of the team (the team's email session cookie, or a Bridge account whose email is a member: its
  `bridge:account:teams:<email>` set, or a local admin in `npm run dev:full`), else anyone on a public demo team
  (`peterbono/bridge-demo-ds`, `peterbono/ai-design-system-demo`) while GitHub says the repository is public. Anyone
  else: 401 `signin`. A member reads only the team of the request, and the path must be under `/repos/<that team>`.
- **Read only**: `GET` only (every other verb is the email contributor policy above, which needs a member and the CSRF
  header); the installation token is narrowed to read permissions (Contents, Pull requests, Issues, and Commit
  statuses and Checks when the installation has them), minted on the server, never sent to the browser and never
  stored. No header of the browser goes to GitHub but a checked `Accept`.
- **Deny by default**: the repository itself, `branches`, `commits`, `compare`, `contents`, `readme`, `git/trees`,
  `git/blobs`, `git/commits`, `git/ref(s)`, `git/matching-refs`, `pulls` and `issues` (and one level below a number:
  files, reviews, comments, timeline...), `labels`, `tags`, `deployments` and their statuses, `rulesets`,
  `rules/branches`, `check-runs/<n>`, `actions/jobs/<n>`, `actions/runs/<n>`; `collaborators` for members only.
  Anything else (hooks, keys, secrets, invitations, environments, traffic, settings, another repository, `/user`,
  GraphQL) answers 403 `not-allowed` without calling GitHub.

### Cache and limits

- **Cache** (Upstash Redis): an answer is fresh 30 seconds, then revalidated with its `ETag` (GitHub does not count a
  `304`), kept 10 minutes to stand in when GitHub says slow down. A write made through Bridge
  (`bridge:read:wrote:<repo>`) makes older answers be checked again at once. Answers that never change (a blob, a tree
  or a commit by its sha, contents at a full sha) are kept a day (blobs a week) and in the function's memory. Keys:
  `bridge:read:get:<repo>:<hash>`, `bridge:read:blob:<repo>:<sha>`. Bodies of private repositories land there: access
  is checked on every request, never by the key.
- **Limits** per 10 minutes: 1,200 requests per address for members, 400 per address on a demo team, 6,000 per team
  (`READ_MAX_IP`, `READ_MAX_GUEST`, `READ_MAX_TEAM`, optional; a blob batch counts 1 per 20 blobs). Over a limit, or
  when GitHub says slow down and nothing is kept: 429 `busy`, `Retry-After`, `{ "message": "Bridge is busy, try again
  in N min.", "retryAfter": <seconds> }`. Studio shows that sentence, never "add a GitHub token".
- **Fallback**: when the server answers that it cannot read (not set up, the app not on the repository), a demo
  team's visitor reads GitHub directly for the rest of the page, as before.

## Accounts

One Bridge account per person, identified by email: no password, no username. "Continue with GitHub" or "Continue
with email" (a 6-digit code by email) on one screen, for signing in and signing up alike. A new email creates the
account and opens onboarding (`/start/`); a known one opens the team joined last. Admins and reviewers link GitHub
(GitHub stays the way to approve, merge and write as themselves); editors may have an email only. People who already
joined a team with their email find that team on their first sign-in with the same email. The server piece is one
Vercel function, `apps/docs-site/api/account/index.ts`; the record and the session live in
`apps/docs-site/api/_lib/account.ts`.

### Endpoints

| Call                                            | Answer                                                                |
| ----------------------------------------------- | --------------------------------------------------------------------- |
| `GET /api/account`                              | `{ available, account }`, account `{ email, name, github, teams }` or null; teams `[{ repo, name, role, via }]` (email memberships; GitHub teams are found on GitHub as before) |
| `POST { action: 'code', email }`                | always `{ ok: true }` for a well-formed email, with or without an account; a daily cap answers 429 for everyone alike |
| `POST { action: 'verify', email, code, name? }` | sets the cookie; `{ account, created, next }`, next `/start/` for a new account, else `/studio/<owner>/<repo>/` (team joined last), else `/studio/` (a GitHub account) or `/start/` |
| `POST { action: 'github', token }`              | a GitHub user token: `GET /user` and `GET /user/emails`, verified emails only. Links GitHub to the account of one of them (primary first), else creates one with the primary verified email. Same answer as verify. 409 `github-taken` when that account is linked to another GitHub account |
| `POST { action: 'rename', name }`               | `{ account }`                                                         |
| `POST { action: 'sign-out' }`                   | clears the cookie on this browser                                     |
| `POST { action: 'sign-out-everywhere' }`        | bumps the account's version: every session ends                       |
| `POST { action: 'delete' }`                     | deletes the account, its GitHub link, its email memberships (which ends their contributor sessions) and every session; 409 `last-admin` with `teams` when the person is the only admin of a team that has other members |

Every `POST` carries `X-Bridge-Account: 1`, JSON, and an `Origin` of this very site (CSRF).

**The last-admin rule.** Email memberships are never admin (admins join with GitHub). For a GitHub-linked account,
Studio sends the person's own GitHub token as `Authorization: Bearer` with `delete`: the function reads the
repositories the Bridge app and the person share (`GET /user/installations`, then each installation's repositories),
and for each one where they are admin, its collaborators and email members. Without that token the GitHub check is
skipped: deleting a Bridge account never changes anything on GitHub, so the team keeps its GitHub admin either way.

### Where to go after sign-in: `/api/entry`

Once the account is verified, Studio calls `GET /api/entry` (account cookie; with the linked GitHub account's own
token as `Authorization: Bearer` when it has one). The first rule that matches answers:

1. `{ kind: 'teams', teams: [{ repo, name, role, via }] }`: email memberships, plus, for an account that already
   linked GitHub, the repositories the Bridge app shares with it where it can push or administer (`via: 'github'`).
   Sign-in itself is by email; an account linked to GitHub earlier is the same account when it signs in by email.
2. `{ kind: 'invites', invites: [{ id, team, repo, role, invitedBy, invitedAt, memberCount, people }] }`: invites
   sent to the account email.
   `POST { action: 'accept-invite', repo, id }` joins at once (Can edit with the email; reviewer and admin need
   linked GitHub, granted to the login read again from the GitHub id).
3. `{ kind: 'domain', domain, teams: [{ repo, name, memberCount, people, adminName, requested }] }`: teams an admin
   opened to the person's work domain, all of them, largest first. `POST { action: 'request', repo }` asks to join (an
   invite for that team is accepted instead); `POST { action: 'cancel-request', repo }` takes back the account's own
   pending request (404 when none waits).
4. `{ kind: 'create' }`.

`people` lists the names of the first four people on the team (GitHub admins first, then other collaborators, then
email members), for the avatars of the team card, which counts the rest as "+N" from `memberCount`. Names only: other
members' emails never leave the server. `invitedBy` and `adminName` are display names: the GitHub profile name, else
the Bridge account name, else the login. Invites keep the inviter's (`invitedByName`) and discovery keeps the admin's
(`byName`) when they are made; older records resolve it when they are read.

Discovery is an admin's choice per team: `POST { action: 'discovery', repo, enabled }` opens the team to the admin's
own work domain (their account email), or closes it; `GET /api/entry?discovery=<repo>` says `{ domain, enabled,
configured, eligible }`. Public mailbox domains (`apps/docs-site/api/_lib/domains.ts`) never match and cannot be
opened. A request emails the team's admins that have a Bridge account; admins list them with
`GET /api/entry?requests=<repo>` and answer with `POST { action: 'approve' | 'decline', repo, id }`. Approved people
join with Can edit and get an email. Requests expire after 14 days, one per person and team, capped per person (10),
network (30) and team (20) per day. Admins are checked on GitHub with the app on every call, matched by GitHub id.
Every `POST` carries `X-Bridge-Contribute: 1` and an `Origin` of this site. Keys: `bridge:team:discovery:<repo>`,
`bridge:team:domain:<domain>`, `bridge:joinreq:<repo>:<email>`, `bridge:joinreqs:<repo>`,
`bridge:joinreq:mine:<email>`, and `bridge:invites:email:<email>` (invites by email, kept by the invite store).

### Codes, sessions and storage

- **Codes**: 6 digits, 10 minutes, single use, one live code per email (a new one replaces the last). Stored only as
  `bridge:account:code:<sha256(email + code)>` `{ email, tries }`, checked in constant time. 5 wrong tries burn the
  code. Caps per UTC day: 5 codes per email, 20 per network, 100 for the site (`ACCOUNT_CODES_MAX_SITE_DAY`), 60 code
  checks and 60 GitHub sign-ins per network (emails and networks under an HMAC). Nothing logs an email or a code.
- **The session**: cookie `bridge_account`, `Path=/`, `HttpOnly`, `Secure`, `SameSite=Lax`, 30 days, signed with
  HMAC-SHA256 under `LIBRARY_SESSION_SECRET` with its own purpose, claims `{ email, v, exp }`. Every request reads the
  account again: a version bump (sign out everywhere) or a deleted account ends it at once.
- **Email contributors**: `/api/contribute` accepts the account session too. An account whose email is a member of
  the team counts as that member; the per-team cookie keeps working.
- **Keys** (the same Upstash Redis as invites): `bridge:account:<email>` `{ id, email, name, github, createdAt,
  version }`, `bridge:account:gh:<githubId>` (the email), `bridge:account:teams:<email>` (set of `owner/repo`, kept by
  the member store), the codes above. Memberships stay `bridge:member:<repo>:<email>`.

### Backup and privacy

A Vercel cron (`crons` in `apps/docs-site/vercel.json`, daily at 03:17 UTC) calls `GET /api/account?export=1` with
`Authorization: Bearer $CRON_SECRET`. The function writes a JSON of `bridge:account:*`, `bridge:member:*`,
`bridge:members:*`, `bridge:invite:*` and `bridge:team:*` (never codes, counters or join requests) to Vercel Blob as a private file,
`bridge-backups/accounts-<date>.json`, and keeps the last 30. Without `BLOB_READ_WRITE_TOKEN` it does nothing and
logs a warning that names no one. Data stays in the Upstash region of each environment and in the Blob store's
region; deleting an account removes it from Redis at once and from the backups within 30 days.

### Set it up (owner of the site)

It reuses storage, Resend (`RESEND_API_KEY`, `INVITE_EMAIL_FROM`) and `LIBRARY_SESSION_SECRET`. For the backup:

1. **Blob store.** In the Vercel project (`bridge-docs`): **Storage**, **Create Database**, **Blob**, connect it to
   Production. It adds `BLOB_READ_WRITE_TOKEN`.
2. **Cron secret.** Add `CRON_SECRET` (Production, Sensitive): 32 characters or more, random
   (`openssl rand -base64 48`). Vercel sends it with every cron call.

| Name                         | Value                                                                    |
| ---------------------------- | ------------------------------------------------------------------------ |
| `BLOB_READ_WRITE_TOKEN`      | Added by step 1. Sensitive                                               |
| `CRON_SECRET`                | Step 2. Sensitive                                                        |
| `ACCOUNT_CODES_MAX_SITE_DAY` | Optional: codes the site sends per day (100). Not sensitive              |

Redeploy. `GET /api/account` answers `{ "available": true, "account": null }` once storage and the secret are set;
the cron's run shows under the project's **Cron Jobs**.

## Test everything locally

`npm run docs:dev` shows the pages only: sign-in, invites, join requests and contributions need the `/api` functions,
which normally run on Vercel. `npm run dev:full` runs them on your computer too, with no keys to set up and no access
to the real site's data.

```sh
npm run dev:full                                  # the whole product on http://localhost:4321
npm run dev:seed -- you@company.com acme/ds       # optional: make that email a member of the acme/ds team
npm run dev:scenario S12                          # optional: start over with one audit scenario (list: dev:scenario list)
npm run dev:reset                                 # start over: forget every local account, team and code
```

**Sign in.** Open the site, choose sign in, and type any email (`test@example.com` works). No email is sent. The code
shows up in the terminal that runs `npm run dev:full`, in a box with `code: 123456`, and on
[localhost:4321/api/dev/outbox](http://localhost:4321/api/dev/outbox), which lists every email Bridge would have sent
(codes, invites, join requests), newest first.

**Where things go.** Accounts, teams, invites and codes live in `apps/docs-site/.bridge-local/` (not in git) and stay
there when you restart. `npm run dev:reset` deletes that folder. `npm run dev:seed` works while the server runs. A new
email with no team lands on "create a team"; a seeded one lands on its team.

**Safe by design.** This mode never reads the storage or email keys (Upstash, KV, Resend, Blob, cron), even when they
are in your shell or `.env.local`, so it cannot touch the real site's data or send a real email. It makes its own
session secret the first time. It refuses to start when `NODE_ENV=production` or on Vercel, and nothing of it is part
of the build.

**Scenarios.** `npm run dev:scenario <name>` (`S0` to `S16`, a number or a slug; `npm run dev:scenario list` lists
them) clears local accounts, teams, codes and the outbox, writes one situation with the same storage functions the
functions use, and prints who to sign in as and what each person should see: a work domain with one or five teams
open to it, a closed team, invites (valid, expired, sent to another email, reviewer and admin), members of one or
three teams, admins with 0, 1 and 4 join requests, a pending request, a request and an invite for the same team, the
last admin, and sign-in code edge cases (`dev/scenarios.ts`). It works while the server runs. The "recent team" of
someone on several teams lives in the browser: set it in the page console with
`localStorage.setItem("bridge.recentTeams", JSON.stringify(["lumen/mobile-kit"]))`, or clear it to get the picker.

**Scenario teams.** Their addresses (`acme/acme-product`, `lumen/brand-system`...) do not exist on GitHub. Locally,
their GitHub calls are answered from this repository's own files at the commit checked out, read-only, with their
own name in `bridge.config.json` (`dev/local-github.ts`), and `/studio/<owner>/<repo>/...` and `/library/<owner>/<repo>/...`
are served from the team and Library shells like the Vercel rewrites do. Each team's admin is seeded as admin for
local mode only (`api/_lib/local-admin.ts`): join requests, discovery and the last-admin check work without a GitHub
App. That override is ignored unless the process runs `npm run dev:full` (BRIDGE_LOCAL=1, not on Vercel, not
production), and no deployed function ever receives it.

**Limits.** Features that act on GitHub need a GitHub App: email contributions (`/api/contribute`), invites from
Members (`/api/invites`), Library access settings (`/api/library-access`), "Continue with GitHub" and admin checks.
Without keys they answer as a site that has not set them up yet ("not available yet"). To try them, put the
`GITHUB_APP_*` variables of a test app in `apps/docs-site/.env.local` (see [SIGN-IN.md](SIGN-IN.md)); they are the only
variables this mode reads from it. Those calls then reach the real GitHub, so use a test repository. With scenario teams, still unreachable locally:
inviting by email, changing roles and removing people from Settings, Members (`/api/invites` needs a GitHub sign-in),
"Continue with GitHub" and joining as reviewer or admin, any write to a scenario team (branches, changes, reviews:
the fixture files are read-only), Library access settings, and a scenario team's Library (`/library/<owner>/<repo>/`
reads a published snapshot that scenario teams do not have). Bridge's own Library and the sample team work as usual.
