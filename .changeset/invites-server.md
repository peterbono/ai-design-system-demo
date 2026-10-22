---
'@bridge-ds/docs-site': minor
---

Invites by email, the server side: `/api/invites` keeps pending invites (email, role, team, who invited, expiry, only a hash of the link token) in an Upstash Redis store, emails a one-time link through Resend, and once the invitee signs in with GitHub gives their account access with the role's permission (Can view: read, Can edit: write, Reviewer: write plus a pull request listing them as design or tech owner, Admin: admin) using the Bridge Direct app's installation token. Admins change roles, remove people, resend and cancel invites; every call re-checks the caller on GitHub. Without storage, email or the app configured, it answers "Invites are not available yet on this site." Setup in docs/HOSTED.md.
