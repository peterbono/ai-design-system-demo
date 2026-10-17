# Branch previews

Test a design system change in a real product's staging before it merges, without touching `main` or production.
Every pull request gets three things:

| Layer | What the team gets | Built by |
| --- | --- | --- |
| Snapshot packages | `npm i https://pkg.pr.new/...@<sha>` installs exactly this commit of `@bridge-ds/tokens`, `core` and `react` | `.github/workflows/preview-packages.yml` |
| Preview deploys | the docs site, Storybook and the admin demo built from the branch, one URL each | Vercel (or Netlify, Cloudflare Pages) |
| Staging token override | a product staging loads the branch's `tokens.css` with `?bridge-tokens=<url>`, no reinstall | `ThemeProvider` `tokenOverride` in `@bridge-ds/react` |

All three show up in one sticky PR comment, "Try this DS branch in your product", and on the docs site's
**Process > Branches** page.

```
DS branch push ──> CI checks
               ├─> Preview packages workflow ──> pkg.pr.new snapshot (or prerelease tarballs) ──> PR comment
               └─> Vercel: bridge-docs, bridge-storybook, bridge-admin preview deploys ───────────> PR comment
Product staging branch: npm i <snapshot>      or      https://staging.product.com/?bridge-tokens=<docs preview>/tokens.css
```

Nothing here publishes to the npm registry or deploys production. Releases are separate (see the last section).

**Explorations** (`explore/<name>` branches with a draft pull request labeled `exploration`) get the same three on
every push, with the comment titled "Try this exploration in your product" and `npm i @bridge-ds/react@<snapshot>`
commands. They are never merged as is: see [EXPLORATIONS.md](EXPLORATIONS.md).

## Five-minute setup

You do these once. None of it is automated, because each step grants access to your accounts.

### 1. Install the pkg.pr.new GitHub App (snapshots)

1. Open <https://github.com/apps/pkg-pr-new> and click **Install** (or **Configure** if it is installed elsewhere).
2. Choose the `peterbono` account, then **Only select repositories** > `ai-design-system-demo` > **Install**.

That is all: no token, no secret. pkg.pr.new is free for open source repositories. The next push to a pull request
publishes snapshots. Until the app is installed, the workflow falls back to `npm pack` tarballs attached to a
`preview-pr-<n>` GitHub prerelease (latest commit only, deleted when the PR closes) and says so in the comment.

### 2. Create three Vercel projects (preview deploys)

At <https://vercel.com/new>, import `peterbono/ai-design-system-demo` three times:

| Project name | Root Directory | Framework preset |
| --- | --- | --- |
| `bridge-docs` | `apps/docs-site` | Astro |
| `bridge-storybook` | `deploy/storybook` | Other |
| `bridge-admin` | `apps/admin` | Vite |

Leave the build and install commands empty: each root's `vercel.json` sets them (install from the repository root
with `npm ci`, build with the monorepo script) and sets the **Ignored Build Step** to
`node ../../scripts/vercel-ignore.mjs <app>`, so a push only rebuilds the apps whose inputs changed.

Then, in each project's **Settings**:

- **General > Root Directory**: keep **Include files outside the root directory in the Build Step** on (the
  default). The builds read `packages/` and the root `package.json`.
- **Deployment Protection > Vercel Authentication**: turn it off for previews, or only people logged in to your
  Vercel team can open them, and a product staging cannot load `tokens.css` from the docs preview. These apps
  hold public demo content only.
- Nothing else: the docs site finds its Storybook from `bridge.config.json` (step 3), the branch Storybook on a
  preview build and `previews.production.storybook` on `main`. `STORYBOOK_URL` still overrides both when set.

### 3. Tell Bridge the preview URLs

Open any preview deployment of each project once and note its branch URL. Vercel names it
`<project>-git-<branch>-<scope>.vercel.app`. Put the pattern in `bridge.config.json`, with `{branch}` where the branch
goes, and the production URL of each app under `production`. This repository's values (Vercel team
`peterbonos-projects`):

```json
"previews": {
  "packages": ["@bridge-ds/tokens", "@bridge-ds/core", "@bridge-ds/react"],
  "apps": {
    "docs": "https://bridge-docs-git-{branch}-peterbonos-projects.vercel.app",
    "storybook": "https://bridge-storybook-git-{branch}-peterbonos-projects.vercel.app",
    "admin": "https://bridge-admin-git-{branch}-peterbonos-projects.vercel.app"
  },
  "production": {
    "docs": "https://bridge.floriangouloubi.com",
    "storybook": "https://bridge-storybook.floriangouloubi.com",
    "admin": "https://bridge-demo.floriangouloubi.com"
  }
}
```

`production` holds fixed URLs (no placeholders). The docs site uses them on `main` and in local builds, for
example to link and embed Storybook; `appUrl()` in `@bridge-ds/core` makes that choice.

Placeholders: `{branch}` (Vercel slug: lowercase, every run of other characters becomes `-`), `{rawBranch}`
(URL-encoded name), `{pr}`, `{sha}`, `{sha7}`. When a branch URL would exceed 63 characters in one DNS label,
Vercel shortens it with a hash nobody can predict; Bridge then leaves that link out and the Vercel bot comment on
the PR has the exact URL. Keep project and branch names short: with `-peterbonos-projects` as the scope, a branch slug of up to 22
characters gets predictable links for all three apps (`bridge-storybook-git-` is the longest prefix; docs allows
27, admin 26).

Commit this on a branch and open a PR: the comment and the Branches page pick it up.

### 4. Check it works

Push a commit to any PR. Within a few minutes the PR shows the Vercel bot comment (three deployments) and the
"Try this DS branch in your product" comment. The **Preview packages** run summary repeats the comment.

## The PR comment

One comment per PR, edited on every push (it starts with `<!-- bridge-branch-preview -->`):

````md
## Try this DS branch in your product

Snapshot of `1a2b3c4` on `agent/badge-subtle`. Install it in a product branch that deploys to staging; production keeps the released version.

```sh
npm i https://pkg.pr.new/peterbono/ai-design-system-demo/@bridge-ds/tokens@1a2b3c4... https://pkg.pr.new/peterbono/ai-design-system-demo/@bridge-ds/core@1a2b3c4... https://pkg.pr.new/peterbono/ai-design-system-demo/@bridge-ds/react@1a2b3c4...
```

| Package | Install this package only |
| --- | --- |
| `@bridge-ds/tokens` | `npm i https://pkg.pr.new/peterbono/ai-design-system-demo/@bridge-ds/tokens@1a2b3c4...` |
| ... | ... |

### Previews

| App | Preview |
| --- | --- |
| Docs | https://bridge-docs-git-agent-badge-subtle-peterbonos-projects.vercel.app/ |
| Storybook | https://bridge-storybook-git-agent-badge-subtle-peterbonos-projects.vercel.app/ |
| Admin demo | https://bridge-admin-git-agent-badge-subtle-peterbonos-projects.vercel.app/ |

Tokens only, no reinstall: open your staging with `?bridge-tokens=https://bridge-docs-git-agent-badge-subtle-peterbonos-projects.vercel.app/tokens.css` ...
````

The text comes from `previewComment()` in `packages/core/src/previews.ts`, the same code the Branches page uses.
Install all packages in one command so `@bridge-ds/react` resolves `@bridge-ds/tokens` to the same snapshot.
Replace the commit with the PR number (`...@bridge-ds/react@42`) to always get the latest commit of that PR.
Fork PRs get no comment: the workflow token is read-only there.

## In the product

### Option A: install the snapshot on a staging branch

```sh
git switch -c try/ds-badge-subtle
npm i https://pkg.pr.new/peterbono/ai-design-system-demo/@bridge-ds/tokens@<sha> \
      https://pkg.pr.new/peterbono/ai-design-system-demo/@bridge-ds/react@<sha>
git commit -am "chore: try DS PR #42 on staging" && git push   # your staging deploy picks it up
```

Full fidelity: components, props and tokens all come from the branch. Throw the branch away when done.

### Option B: preview only the tokens, without reinstalling

For token changes (color, radius, density), keep the installed packages and let staging load the branch's
`tokens.css` on top. Opt in once in the product:

```tsx
<ThemeProvider
  asRoot
  tokenOverride={{
    enabled: import.meta.env.VITE_BRIDGE_TOKEN_PREVIEW === 'true', // set only in the staging environment
    allowInProduction: true, // staging builds are production builds; still off unless `enabled`
    allow: ['https://bridge-docs-git-agent-badge-subtle-peterbonos-projects.vercel.app'],
  }}
>
```

Then open `https://staging.product.com/?bridge-tokens=<docs preview>/tokens.css`. The choice is remembered in
`localStorage` for the next pages; `?bridge-tokens=off` clears it. The page gets
`data-bridge-tokens-override="<host>"` on `<html>` and a console line, so testers know what they are looking at.
Without a ThemeProvider, call `useTokenOverride(options)` or `applyTokenOverride(options)`.

Rules the override enforces:

- Off unless `enabled` is `true` **and** `allow` is not empty.
- Refused when `process.env.NODE_ENV === 'production'` unless `allowInProduction` is also `true`.
- `https:` only (plain `http:` for `localhost`), no credentials in the URL, path must end in `.css`.
- The URL must match an `allow` entry: an origin (`https://docs.example.com`), an origin plus path prefix
  (`https://cdn.example.com/bridge/`) or a wildcard subdomain of a domain you own (`https://*.preview.example.com`).
  Anything else, `*`, `https://*` or `https://*.com` included, matches nothing.
- A stored URL is re-validated on every load, so removing an origin from `allow` revokes it.

## Security

Loading a stylesheet from a URL is CSS injection by design, so treat the allowlist as a security boundary.

- **What CSS can do.** A hostile stylesheet cannot run JavaScript, but it can restyle or hide anything (fake
  prompts, hidden warnings, clickjacking-style overlays), and attribute selectors with `background-image: url()`
  can leak attribute values such as CSRF tokens or input values to another server. Only allow origins you control.
- **Never allowlist shared hosting wildcards** such as `*.vercel.app`, `*.netlify.app` or `*.pages.dev`: anyone
  can deploy there. Vercel branch URLs are not under a wildcard you own, so allowlist each exact branch origin,
  or give previews a custom domain (Vercel Pro: Preview Deployment Suffix) and allow `https://*.<your-domain>`.
  Cloudflare Pages branch aliases (`<branch>.<project>.pages.dev`) live under your project's name, so
  `https://*.<project>.pages.dev` is safe there.
- **Keep it out of production.** Wire `enabled` to a variable that only staging sets. `allowInProduction` exists
  because staging builds usually run with `NODE_ENV=production`; it does not enable anything by itself.
- **A link is enough to apply it.** Anyone can send a tester a `?bridge-tokens=` link; the allowlist is what stops
  a foreign stylesheet. Add a Content Security Policy `style-src` with the same origins for defense in depth.
- **Snapshots are code.** `npm i https://pkg.pr.new/...` runs whatever the PR contains (install scripts, component
  code). Install snapshots from PRs you have read, on staging only. Fork PRs get no snapshot from this workflow.

## Other hosts

The apps build anywhere with the same commands; only Vercel is configured in the repository.

- **Netlify**: three sites from the same repo, base directory empty (repository root), build commands
  `npm run docs:build` / `npm run build-storybook` / `npm run admin:build`, publish directories `apps/docs-site/dist`, `storybook-static`, `apps/admin/dist`. Deploy previews are per PR
  (`deploy-preview-<pr>--<site>.netlify.app`, template `https://deploy-preview-{pr}--<site>.netlify.app`). Add a
  `/* /index.html 200` redirect for the admin.
- **Cloudflare Pages**: same three projects; branch aliases are `https://{branch}.<project>.pages.dev` (Cloudflare
  shortens long names). The docs build reads `CF_PAGES_BRANCH`.
- **GitHub Pages** serves one site per repository and has no per-PR deploys, so it does not fit previews. For a
  production mirror under a sub-path, build the admin with `BASE_PATH=/<repo>/admin/ npm run admin:build` (the
  router follows `import.meta.env.BASE_URL`). The docs site uses root-relative links and must be served from a
  domain root.

Base paths: the docs site and the admin are served from `/` on every preview host above. `SITE_URL` (or the
preview host's branch URL) sets absolute URLs in the docs; the docs link and embed the branch Storybook from the
`storybook` template when built on a preview host.

## Releases to npm

Separate from previews, inert until you enable it.

- Scope: `@bridge-ds` (renamed from `@demo-ds` and `@bridge`; `@bridge` is an existing npm organization). On
  2026-10-16 `@bridge-ds/tokens`, `@bridge-ds/core`, `@bridge-ds/react` and the `bridge-ds` scope were free. Other
  branches can apply the rename with `node scripts/rename-scope.mjs` (`--check` fails if an old name is left).
- `npm run build:packages` builds each package's `dist/` and checks every export target exists. Inside the
  monorepo, apps, Storybook and tests resolve the `source` export condition to the TypeScript sources, so nothing
  needs building to develop.
- `.github/workflows/release.yml` runs on pushes to `main` with Changesets: it opens a "Version packages" PR from
  pending `.changeset/*.md` files, and publishes to npm (with provenance) when that PR merges.

To enable it:

1. Create the npm organization `bridge-ds` at <https://www.npmjs.com/org/create> (free for public packages).
2. Create a granular access token at npmjs.com > Access Tokens > **Generate New Token** > Granular: packages and
   scopes **Read and write**, scope `@bridge-ds`, an expiry you will remember to rotate.
3. GitHub repository > Settings > Secrets and variables > Actions > **New repository secret**: `NPM_TOKEN`.
4. Settings > Actions > General > Workflow permissions: allow GitHub Actions to create pull requests.

Without `NPM_TOKEN` the release job only prints a notice.
