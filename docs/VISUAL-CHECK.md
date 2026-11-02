# Visual check: the Screens comment

Every pull request that touches UI gets one comment, **Screens**, with real screenshots of the screens it changes:
desktop (1440 by 900) and mobile (390 by 844), light and dark, next to the same screens on `main`. Read it before you
merge. It exists because agents on small machines often skip rendering; CI renders instead.

Workflow: `.github/workflows/screens.yml`. Script: `scripts/screens.mjs`. Route map: `scripts/screens.map.json`.

## When it runs

On pull requests that change one of these paths (opened, new commits, reopened, ready for review):

- `apps/docs-site/src/components/**`, `pages/**`, `styles/**`, `scripts/**`, `layouts/**`, `lib/**`
- `apps/docs-site/api/_lib/notify-mail.ts` and `email.ts` (the notification emails)
- `packages/react/src/components/**`, `packages/tokens/src/**`
- the check itself (`scripts/screens.mjs`, `scripts/screens.map.json`, the workflow)

Tests, stories and `*.docs.json` never pick a screen. One run per pull request at a time: a new commit cancels the
run in progress.

## What it renders

The docs site is built (`astro build`) twice, for the pull request head and for its merge base with `main`, and served
statically with the rewrites of `apps/docs-site/vercel.json`. No Vercel deploy is involved (agent branches get none).

- Studio pages are the **sample team** `peterbono/bridge-demo-ds`, signed out, with its sample data, exactly what a
  visitor sees. First-visit tours are marked as seen so the page shows.
- Library pages are that team's public Library; public pages are the landing, Start and Sign in.
- Emails are `notify-mail` rendered with sample names (a question, the daily summary).

Never a private team, a product repository or anyone's account: only sample data and public pages, the same rule as
the preview shots (docs/EXPLORATIONS.md). The sample team's GitHub reads go through the workflow's own token, read
only, cached for the run, so base and head see the same data.

### Which screens

`scripts/screens.map.json` maps changed files to screens with globs, for example `ProductPage.tsx` to the product
page, `ExplorationPage.tsx` to an exploration, Settings components to Settings, `notify-mail.ts` to the emails. A UI
file no rule names adds the default set: Studio home, Changes, an exploration, Being built, Settings, a product page.
At most 8 screens per run (rule screens first); the comment names the ones left out.

When you add a screen or a component that a rule does not cover, add a rule. Keep screens on the sample team.

## The check

The job **Screens** fails only on render errors the pull request adds:

- a page that crashes, does not load or answers an error status;
- a console error or an uncaught exception;
- horizontal scroll at 390 px (the comment names the elements that stick out).

An error `main` already has on the same screen, size and theme is a warning, not a failure. Accessibility violations
(axe-core, WCAG 2.1 A and AA) are always warnings, listed in the comment. Requests to `/api/*` are expected to fail
in a static build and are not errors.

Screens is not a required check: red means "look before you merge", not "blocked".

## Reading the comment

- One summary line: how many screens, the head and base commits, the run.
- Render errors first, if any.
- One block per screen, the ones that changed against `main` first and open, with the share of pixels that changed
  under each image. **Before (main)** holds the base images of the views that changed.
- Warnings folded at the end.

Click an image for full size. The full-size PNGs of every view, before and after, are in the run's artifact
(`screens-pr-<number>`, 14 days).

## Where the images live

WebP files on the public orphan branch `bridge-shots`, under `pr-<number>/<head sha>/` (`after/` every view,
`before/` only the views that changed, `report.json`). Only the latest head is kept; the folder is removed when the
pull request closes. The comment embeds them by `raw.githubusercontent.com` URL (artifacts cannot be shown inline).
Pull requests from forks still render and upload the artifact; publishing and the comment are skipped (read-only
token).

## Cost and limits

- About 4 to 6 minutes: two installs and builds (about 40 s each), then the captures, three pages at a time.
- The browser is the runner's Google Chrome through `playwright-core`: nothing to download or cache.
- GitHub: the workflow token only, a few dozen reads per run (the sample team's data), never a person's quota.
- Data that moves (an exploration merged on the sample team, relative dates) can show as a small change on both sides
  when `main` and the head are rendered minutes apart; the cache keeps the data itself the same.
- It renders signed-out views only. Screens that need a signed-in member (an admin's Settings, an email member's
  exploration) still need a manual look or a local `npm run dev:full` scenario (docs/HOSTED.md).

## Run it locally

```sh
npm run docs:build
node scripts/screens.mjs plan --base origin/main
BRIDGE_CHROME_CHANNEL=chrome node scripts/screens.mjs capture --site apps/docs-site/dist --out /tmp/screens --screens home,settings
```

`GH_TOKEN` is optional locally: without it the sample team is read anonymously (60 GitHub reads an hour).
