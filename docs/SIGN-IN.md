# Sign in with GitHub

Designers sign in to Studio with one click instead of creating and pasting a personal token. It needs one GitHub App
that you, the owner, create once, and its environment variables on Vercel.

## One app: Bridge Direct

Bridge signs everyone in with **one** GitHub App, **Bridge Direct** (named "Bridge Design Studio" on GitHub, slug
`bridge-design-studio`, settings at github.com/settings/apps/bridge-design-studio). It is also the server's app: the
same app id and private key (`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`) read teams for email members, receive the
webhook and sign people in to the MCP server. One consent on GitHub covers reading, suggestions and code writes.

- **Sign in** on every page (team pages, the team Library, the start screen and the self-hosted Studio) uses Bridge
  Direct's Client ID (`GITHUB_APP_CLIENT_ID`). The token that reads is the token that writes: there is no second OK.
- **Install Bridge**, **Give Bridge access**, "Ask your lead to install Bridge", the install checks and the
  installation lookups (`GET /user/installations`, which lists the installations of the app that issued the token) all
  target Bridge Direct. The slug comes from one place: `appSlugFrom` in `apps/docs-site/src/lib/github-signin.ts`
  (`GITHUB_APP_DIRECT_SLUG`, default `bridge-design-studio`), written on `<html data-gh-slug>` for the browser.
- **Suggest mode still works**: suggestions are issues and pull requests the person files with their own sign-in;
  Bridge Direct has Issues and Pull requests write. In suggest mode Bridge keeps to suggestions in software (Settings
  says so), since the app itself could write code.
- A user can never do more through the app than their own access to the repository allows.

### People still signed in with the old app

Until 2026-11-04 team pages signed in with a second app, **Bridge** (`bridge-ds`), and asked for Bridge Direct's OK
the first time a team in direct mode saved code. That app and its "Allow Bridge to save your changes" dialog are gone.
A browser that still holds a `bridge-ds` sign-in (`bridge.github.token.suggest` in localStorage) looks signed out on
its next Studio page and sees one sentence, once: "Bridge changed how it connects to GitHub. Sign in again once to
keep working." The page removes that old sign-in at the same time (`planSlots` in `lib/github-signin.ts`): nothing
can use or renew it any more. Someone who had already given Bridge Direct its OK stays signed in, with no notice.

This is all in the browser: the token function accepts Bridge Direct's Client ID only, and refuses any other
(`unknown_client`), so it never needs the old app's id or secret.

Once the Client ID is set at build time, Sign in with GitHub is the only way into Studio: the sign-in dialog, Settings,
the account menu and the side nav offer no token paste. Developers keep their own token for the CLI and the MCP
server (`GITHUB_TOKEN`), which this does not touch. A token pasted in the browser before the switch keeps working until
its owner disconnects; after that they sign in.

Until the Client ID exists (a fork, `astro dev` without the env var), Studio offers the token paste as its only way
in, exactly as before, so nobody is locked out.

No database: the user's token lives in their browser, like a pasted token. The only server piece is one Vercel
function, `apps/docs-site/api/github/token.ts`, which adds the app's client secret to swap GitHub's one-time code
for a token, and renews tokens when they expire. It stores and logs nothing.

## 1. Create the GitHub App (5 minutes)

Create **Bridge Direct**.

1. Open <https://github.com/settings/apps/new> (for a repository owned by an organization:
   `https://github.com/organizations/<org>/settings/apps/new`).
2. Fill in:
   - **GitHub App name**: `Bridge Direct` (must be unique on GitHub; add your name if it is taken).
     People see it on the GitHub consent screen.
   - **Homepage URL**: `https://bridge.floriangouloubi.com`
   - **Callback URLs**: `https://bridge.floriangouloubi.com/studio/auth/callback/` (with the final slash; previews
     and local servers are forwarded through it, see below) and `https://bridge.floriangouloubi.com/oauth/github`
     (the MCP server's sign-in, docs/MCP-SERVER.md).
   - **Setup URL**: `https://bridge.floriangouloubi.com/studio/auth/access/`, with **Redirect on update** checked.
     After **Install Bridge** or **Give Bridge access**, GitHub sends the guided window there and it tells Studio.
   - **Expire user authorization tokens**: keep it checked. Tokens last 8 hours and Studio renews them silently.
   - **Request user authorization (OAuth) during installation**: leave unchecked. Checked, GitHub drops the Setup URL
     and sends installers to the callback without Studio's state, which Studio refuses.
   - **Enable Device Flow**: leave unchecked.
   - **Webhook**: the hosted Bridge uses it (`/api/github-webhook`, docs/HOSTED.md). A self-hosted Studio alone can
     leave **Active** unchecked.
3. **Permissions**: set exactly these, leave everything else on "No access".

   **Bridge Direct** (the one app; writes branches and pull requests, and files suggestions):

   | Group        | Permission      | Access         | What Studio does with it                                                            |
   | ------------ | --------------- | -------------- | ----------------------------------------------------------------------------------- |
   | Repository   | Contents        | Read and write | Read tokens and components; save token and docs changes on a new branch; ship        |
   | Repository   | Pull requests   | Read and write | Open changes for review, approve or request changes, ship or close them             |
   | Repository   | Issues          | Read and write | Component requests, the visual check label, comments on changes                     |
   | Repository   | Administration  | Read and write | Settings, Protection: read the branch rules, "Protect the library" creates them      |
   | Repository   | Checks          | Read only      | Test results on each change                                                          |
   | Repository   | Commit statuses | Read only      | Preview links and statuses on each change                                            |
   | Repository   | Metadata        | Read only      | Required by GitHub                                                                   |
   | Organization | Members         | Read only      | Roles held by GitHub teams in Settings (only for a repository owned by an organization) |

   Administration can be "Read only" if you prefer to turn protection on from GitHub yourself.

   Bridge Direct has all of these today, plus Workflows write. Optional: **Workflows: Read and write** lets Settings, Claude, "Set up automatic measure" open its pull request
   (it adds `.github/workflows/bridge-measure.yml`; GitHub refuses workflow files to an app without it). Without it,
   Studio gives the file to commit from GitHub instead (docs/MEASURE.md).

   **Account permissions**: **Email addresses: Read-only**, and nothing else. Linking GitHub to a Bridge
   account uses it to read the verified emails of that GitHub account (`GET /user/emails` with their own sign-in;
   docs/HOSTED.md, "Invites by email"), so a reviewer or admin invite goes to the person it was sent to. When you add
   it to an existing app, people already signed in get it the next time they sign in. A pasted token needs the same: the `user:email` scope (classic) or Email addresses
   read (fine-grained).

   A user can never do more through the app than their own access to the repository allows.
4. **Where can this GitHub App be installed?**: **Any account**. The hosted Bridge serves every team's repository
   (`/studio/<owner>/<repo>/`), so people from other accounts and organizations must be able to sign in and to
   install it on their own repositories. A private app ("Only on this account") refuses their sign-in. An app that
   is already private: its **Advanced** settings, **Make public**. Treat it as one way: once teams have installed it,
   making it private again breaks their Bridge. Public only lists the app at `https://github.com/apps/<slug>`;
   installing it stays free, per repository, and gives nobody more than their own access on GitHub.
5. Click **Create GitHub App**.
6. On the app's page, note the **Client ID** (it starts with `Iv`). Click **Generate a new client secret** and copy
   it straight into Vercel (step 2). Do not paste it anywhere else. The hosted Bridge also needs a private key for the
   server (`GITHUB_APP_PRIVATE_KEY`, docs/HOSTED.md); a self-hosted Studio alone does not.
7. In the app's left menu, click **Install App**, then **Install** next to your account, choose **Only select
   repositories**, pick `ai-design-system-demo`, and click **Install**. Other teams install it on their own
   repositories themselves (see "A team's Bridge" below).

## 2. Set the environment variables on Vercel

In the Vercel project that deploys Bridge (`bridge-docs`): **Settings**, **Environment Variables**. Add each one for
**Production** and **Preview**:

| Name                               | Value                                   | Notes                                |
| ---------------------------------- | --------------------------------------- | ------------------------------------ |
| `GITHUB_APP_CLIENT_ID`             | Bridge Direct's Client ID (step 1.6)    | Public: it is written into the pages |
| `GITHUB_APP_CLIENT_SECRET`         | Bridge Direct's client secret           | Mark it **Sensitive**. Server only   |
| `GITHUB_APP_DIRECT_SLUG`           | Bridge Direct's slug (optional)         | The end of `github.com/apps/<slug>`. Default `bridge-design-studio`. Every install link uses it |

The Client ID is read at build time by the pages (no `PUBLIC_` prefix needed) and the pair by the token function,
which accepts only that Client ID and adds the secret.

Then redeploy production (**Deployments**, the latest production deployment, **Redeploy**): the pages read the
Client ID at build time, and the ignored build step skips builds when no file changed.

## 3. Check it

Open Studio, signed out. Every Studio page shows **Sign in with GitHub** at the bottom of the side nav, and
Settings, Account says **Sign in with GitHub** too, with no token option. Click it, approve on GitHub, and you
land back on Settings with "Connected as @you" and **Can edit**.

To let a designer in: add them on GitHub (Settings, **Collaborators and teams** on the repository, or a GitHub team
of the organization), then send them the team link (Studio, Settings, **Your team**, **Copy link**). They open it and
click **Sign in with GitHub**; nothing else to set up on their side. Read access is enough to review and send
suggestions; write access lets them start changes in direct mode.

## A team's Bridge (hosted)

The hosted site opens any repository at `https://bridge.floriangouloubi.com/studio/<owner>/<repo>/`. No Bridge account
and no Bridge database: GitHub decides who gets in.

1. An admin of the repository installs **Bridge** on it once:
   [github.com/apps/bridge-design-studio/installations/new](https://github.com/apps/bridge-design-studio/installations/new),
   **Only select repositories**, pick the design system. Studio shows this link to admins of a repository where Bridge is not set
   up, and an "Ask your lead to install Bridge" message to everyone else.
2. The admin shares the team link: Studio, Settings, **Your team** (or the onboarding step **Invite your team**, or
   **Invite your team** in the team menu at the top of the side nav). "Who can do what" under the link says what each
   GitHub access level gives in Bridge, and **Manage access on GitHub** opens the repository's access settings.
3. Each person opens the link and signs in with GitHub.

What each person sees, from what GitHub says:

| Situation | Studio |
| --- | --- |
| Signed out, public repository | The Studio, read only, with "Sign in with GitHub to review changes and send suggestions"; the team chip says "Guest" ("Explore freely" on the demo) |
| Signed out, private or unknown repository | "Sign in with GitHub to open owner/repo" (GitHub does not say which) |
| Signed in, GitHub does not show the repository | "You do not have access to owner/repo yet", with **Ask your lead for access** (copies a message with the link and their GitHub name), **Sign in with another account**, and the invitation page for people already invited |
| Bridge not set up on the repository | A banner: admins get **Install Bridge**, everyone else **Ask your lead to install Bridge** |
| Public repository, not on the team | Read only; they can still send suggestions for the team to review |
| Read, write or admin | The Studio as usual; the team chip says "Can suggest", "Can edit" or "Admin" |

### Coming back from GitHub

A trip to GitHub never loses what the person was doing:

- **Sign in again** (the sign-in expired in the middle of a save): the dialog arms its action right before the save
  (`scripts/pending-action.ts`, memory only). Starting the sign-in keeps an action armed in the last 5 minutes, with
  the page and the time, in localStorage (plain values only, never a token, 15 minutes). GitHub sends the person back
  to the very page (path, search and hash), where the dialog reopens at the same step with what they typed, the
  primary button focused and one line such as "Back from GitHub. Create Atlas now?". Nothing is sent before they
  click. A plain sign-in with nothing armed keeps nothing.
- **Add a product, Install on GitHub / Give Bridge access**: the step is kept when GitHub's window opens. When the
  access page (`/studio/auth/access/`) cannot tell the window that opened it (GitHub cut the link), its **Back to
  Studio** goes to the page Add a product was open on, and "It's already built" reopens there.
- Add a product (new or already built) reopens wherever the person lands (`components/ds/studio/ResumeAction.tsx`);
  Start an exploration, a product's rename and removal and a new brand reopen in place; other saves get one short
  notice to do it again. Back without a sign-in, the line is "Sign in again to finish."
- A save that stopped because the sign-in expired shows the sign-in sentence ("Your GitHub sign-in expired. Sign in
  again to keep editing."), never "Ask an owner" or a generic refusal, since signing in fixes it
  (`signInNeededLine` in `lib/pending-action.ts`).

## The Figma plugin: Sign in with Bridge

Designers connect the DS Bridge plugin with the Bridge account they already use, instead of pasting a GitHub token.

1. In the plugin, **Sign in with Bridge** asks `POST /api/plugin-link { action: "start" }` for a one-time code and a
   poll secret, and opens `/studio/connect-figma/?code=…` in the browser. The secret stays in the plugin.
2. On that page the person signs in to Bridge if needed, connects GitHub once if this browser has no GitHub sign-in,
   picks the team, and presses **Connect Figma**. The page sends the code, the team's repository and this browser's
   GitHub sign-in (`approve`, same origin only). The server checks with GitHub that the sign-in can read that repository
   (`wrong_team` otherwise) and keeps the answer.
3. The plugin polls (`poll`, every 3 seconds, with its secret) and receives the repository, the team name, the default
   branch and the token, once. It saves the token on that computer (`figma.clientStorage`, marked as a Bridge sign-in)
   and the repository with the file.

Codes are stored in Redis (the storage the other `/api` functions use) for 5 minutes, keyed by the code's SHA-256, with
the poll secret as a hash. A code is used once: a second approve is refused (409) and the approved answer is taken with
`GETDEL`. Nothing is logged, and no token is ever shown on screen.

The plugin gets the access token Studio holds, renewed first when it is close to expiry, and its expiry, but not the
refresh token. GitHub refresh tokens rotate on use, so sharing one would sign Studio out. When the token expires (8
hours with expiring user tokens), the plugin says "Sign in again", and it takes one click once Studio is signed in.
Without storage, the endpoint answers 503 and the plugin offers the token below.

A pasted fine-grained token stays available under **For developers: connect with a token** in the plugin's Settings
(see apps/figma-plugin/README.md).

## What people see when something is off

- They cancel on GitHub: "You cancelled the sign-in on GitHub, so Studio stays read only."
- The token expired and cannot be renewed (after 6 months, or access revoked): "Your GitHub sign-in expired. Sign in
  again to keep editing."
- They signed in with an account that cannot reach the repository (another GitHub account, or the app is not
  installed on it): "@login cannot edit owner/repo through Bridge. Ask the repository owner to install the Bridge
  GitHub App on it and give you write access, or sign out and sign in with another GitHub account."
- They can read but not write: "Ask an owner for write access."
- The app lacks a permission: "The Bridge GitHub App cannot (do this) yet. Ask the repository owner to give it
  (permission): Read and write."
- They were signed in with the old app (`bridge-ds`), or the app behind their sign-in was replaced: "Bridge changed
  how it connects to GitHub. Sign in again once to keep working."
- The env vars are missing on the host: "Sign in with GitHub is not set up on this site yet. Ask the site owner to
  finish the setup."

## Previews and local servers

GitHub sends everyone back to the production callback. When the sign-in started on a preview or a local server,
that page forwards it there, but only to addresses that match `previews.apps.docs` in `bridge.config.json`
(`https://bridge-docs-git-{branch}-peterbonos-projects.vercel.app`) or `localhost`. Use a preview's branch URL,
not its hash URL. Previews need the variables in the Preview environment. `astro dev` has no function: run
`vercel dev` for the full flow, or run `astro dev` without the Client ID to get the token paste. The production site needs this change deployed before previews can
sign in, since the callback page lives there.

## Security, in short

- State and PKCE (S256) on every sign-in; the state is checked in the tab that started it, and is good for one use
  within 10 minutes.
- The one-time code is removed from the address bar as soon as the callback page opens. Tokens never appear in a
  URL: the function answers a same-origin POST.
- The function signs with the one configured app; a page that sends any other Client ID is refused before GitHub is
  called.
- The function accepts only POST with JSON from a page on its own host (Origin and Sec-Fetch-Site checked), only the
  Studio callback as redirect address, answers with `Cache-Control: no-store`, and never logs.
- Sign out removes the token and its refresh token from the browser. To revoke every session at once:
  GitHub, **Settings**, **Applications**, **Authorized GitHub Apps**, **Revoke** (or regenerate the client secret).
