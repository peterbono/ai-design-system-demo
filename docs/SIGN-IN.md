# Sign in with GitHub

Designers sign in to Studio with one click instead of creating and pasting a personal token. It needs GitHub Apps
that you, the owner, create once, and their environment variables on Vercel.

## Two apps, one per way changes reach the code

`bridge.config.json` `"changes"` says how changes reach the code, and Studio signs people in with the matching app:

| App               | Used when                                  | Can write code | Env vars on Vercel                                                   |
| ----------------- | ------------------------------------------ | -------------- | -------------------------------------------------------------------- |
| **Bridge**        | `"changes": "suggest"` (the default)        | No             | `GITHUB_APP_SUGGEST_CLIENT_ID`, `GITHUB_APP_SUGGEST_CLIENT_SECRET`   |
| **Bridge Direct** | `"changes": "direct"`                       | Yes            | `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`                   |

- **Bridge** reads the code and writes only issues: designers' changes become suggestions that a developer applies.
  A DS owner gets least privilege: nobody can push code through Studio.
- **Bridge Direct** (the app first created as "Bridge Studio") opens branches and pull requests for every change.
- With only one of the two configured, Studio signs in with that one whatever the mode (a site that never created
  the Bridge app keeps working exactly as before). In suggest mode with only Bridge Direct, Bridge still keeps to
  suggestions in software, but the app itself could write code.
- Tokens of each app are stored apart in the browser (`bridge.github.token.suggest`, `bridge.github.token.direct`).
  When the mode changes, Studio removes a sign-in made with the other app at the next page load and asks to
  "Sign in again". A token pasted by hand belongs to no app and is kept.

Once the Client ID is set at build time, Sign in with GitHub is the only way into Studio: the sign-in dialog, Settings,
the account menu and the side nav offer no token paste. Developers keep their own token for the CLI and the MCP
server (`GITHUB_TOKEN`), which this does not touch. A token pasted in the browser before the switch keeps working until
its owner disconnects; after that they sign in.

Until the Client ID exists (a fork, `astro dev` without the env var), Studio offers the token paste as its only way
in, exactly as before, so nobody is locked out.

No database: the user's token lives in their browser, like a pasted token. The only server piece is one Vercel
function, `apps/docs-site/api/github/token.ts`, which adds the app's client secret to swap GitHub's one-time code
for a token, and renews tokens when they expire. It stores and logs nothing.

## 1. Create the GitHub Apps (5 minutes each)

Create **Bridge** for suggest mode, and **Bridge Direct** if the repository uses direct mode. The steps are the same;
only the name and the permissions (step 3) differ.

1. Open <https://github.com/settings/apps/new> (for a repository owned by an organization:
   `https://github.com/organizations/<org>/settings/apps/new`).
2. Fill in:
   - **GitHub App name**: `Bridge` or `Bridge Direct` (must be unique on GitHub; add your name if it is taken).
     People see it on the GitHub consent screen.
   - **Homepage URL**: `https://bridge.floriangouloubi.com`
   - **Callback URL**: `https://bridge.floriangouloubi.com/studio/auth/callback/` (with the final slash). One is
     enough: previews and local servers are forwarded through it (see below).
   - **Expire user authorization tokens**: keep it checked. Tokens last 8 hours and Studio renews them silently.
   - **Request user authorization (OAuth) during installation**: leave unchecked.
   - **Enable Device Flow**: leave unchecked.
   - **Webhook**: uncheck **Active**. Bridge needs no webhook.
3. **Permissions**: set exactly these, leave everything else on "No access".

   **Bridge** (suggest, read only on code):

   | Group        | Permission      | Access         | What Studio does with it                                                            |
   | ------------ | --------------- | -------------- | ----------------------------------------------------------------------------------- |
   | Repository   | Contents        | Read only      | Read tokens, components and docs                                                     |
   | Repository   | Issues          | Read and write | Suggestions (each one is an issue), reviews of suggestions, component requests       |
   | Repository   | Pull requests   | Read only      | The pull requests that apply suggestions, the review queue, product branches         |
   | Repository   | Checks          | Read only      | Test results on each change                                                          |
   | Repository   | Commit statuses | Read only      | Preview links and statuses on each change                                            |
   | Repository   | Metadata        | Read only      | Required by GitHub                                                                   |
   | Organization | Members         | Read only      | Roles held by GitHub teams in Settings (only for a repository owned by an organization) |

   No Administration: Settings, Protection says "ask an admin" instead of turning protection on.

   **Bridge Direct** (writes branches and pull requests):

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

   Administration can be "Read only" if you prefer to turn protection on from GitHub yourself. Account permissions:
   none. A user can never do more through the app than their own access to the repository allows.
4. **Where can this GitHub App be installed?**: **Only on this account**.
5. Click **Create GitHub App**.
6. On the app's page, note the **Client ID** (it starts with `Iv`). Click **Generate a new client secret** and copy
   it straight into Vercel (step 2). Do not paste it anywhere else. You do not need a private key.
7. In the app's left menu, click **Install App**, then **Install** next to your account, choose **Only select
   repositories**, pick `ai-design-system-demo`, and click **Install**.

## 2. Set the environment variables on Vercel

In the Vercel project that deploys Bridge (`bridge-docs`): **Settings**, **Environment Variables**. Add each pair for
**Production** and **Preview**:

| Name                               | Value                                   | Notes                                |
| ---------------------------------- | --------------------------------------- | ------------------------------------ |
| `GITHUB_APP_SUGGEST_CLIENT_ID`     | Bridge's Client ID (step 1.6)           | Public: it is written into the pages |
| `GITHUB_APP_SUGGEST_CLIENT_SECRET` | Bridge's client secret                  | Mark it **Sensitive**. Server only   |
| `GITHUB_APP_CLIENT_ID`             | Bridge Direct's Client ID (step 1.6)    | Public: it is written into the pages |
| `GITHUB_APP_CLIENT_SECRET`         | Bridge Direct's client secret           | Mark it **Sensitive**. Server only   |

The Client IDs are read at build time by the pages (no `PUBLIC_` prefix needed) and both pairs by the token function,
which accepts only those two Client IDs and adds the matching secret.

Then redeploy production (**Deployments**, the latest production deployment, **Redeploy**): the pages read the
Client ID at build time, and the ignored build step skips builds when no file changed.

## 3. Check it

Open Studio, signed out. Every Studio page shows **Sign in with GitHub** at the bottom of the side nav, and
Settings, Account says **Sign in with GitHub** too, with no token option. Click it, approve on GitHub, and you
land back on Settings with "Connected as @you" and **Can edit**.

To let a designer in: add them as a collaborator with write access on the repository. They click **Sign in with
GitHub**; nothing else to set up on their side.

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
- The site moved to the other app (the mode changed): "Bridge now signs in to GitHub with a different app, so your
  previous sign-in was removed. Sign in again to keep editing."
- The env vars are missing on the host: "Sign in with GitHub is not set up on this site yet. Ask the site owner to
  finish the setup."

## Previews and local servers

GitHub sends everyone back to the production callback. When the sign-in started on a preview or a local server,
that page forwards it there, but only to addresses that match `previews.apps.docs` in `bridge.config.json`
(`https://bridge-docs-git-{branch}-peterbonos-projects.vercel.app`) or `localhost`. Use a preview's branch URL,
not its hash URL. Previews need the variables in the Preview environment. `astro dev` has no function: run
`vercel dev` for the full flow, or run `astro dev` without either Client ID to get the token paste. The production site needs this change deployed before previews can
sign in, since the callback page lives there.

## Security, in short

- State and PKCE (S256) on every sign-in; the state is checked in the tab that started it, and is good for one use
  within 10 minutes.
- The one-time code is removed from the address bar as soon as the callback page opens. Tokens never appear in a
  URL: the function answers a same-origin POST.
- The function signs with the app whose Client ID the page sends, only from the two configured ones; an unknown one
  is refused before GitHub is called.
- The function accepts only POST with JSON from a page on its own host (Origin and Sec-Fetch-Site checked), only the
  Studio callback as redirect address, answers with `Cache-Control: no-store`, and never logs.
- Sign out removes the token and its refresh token from the browser. To revoke every session at once:
  GitHub, **Settings**, **Applications**, **Authorized GitHub Apps**, **Revoke** (or regenerate the client secret).
