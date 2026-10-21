---
'@bridge-ds/docs-site': minor
---

Studio team context in the browser (multi-team PR 2b). `scripts/repo-context.ts` names the repository a page works on
(the team address `/studio/<owner>/<repo>/` on a team shell, else `#bridge-repo` as before) and its settings
(`siteConfig`), and loads a team's repo model from GitHub with core `loadRepoModel` and `gitHubSource`, cached in
IndexedDB by repository and head sha (`scripts/repo-cache.ts`). Access is now read per repository with core
`resolveRepoAccess` and its eight states (`resolveAccess`, `lib/access.ts`); a read-only outside contributor is no
longer told that Bridge is not installed. Sign-out removes cached private repositories. Signing in with one GitHub App
no longer removes the other App's sign-in, and `pickSignInApp` signs in for identity with the read-only app first,
with Bridge Direct only to write in direct mode. The self-hosted site behaves as before.
