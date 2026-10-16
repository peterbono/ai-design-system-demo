# Changesets

Every PR that changes a package adds a changeset (`npm run changeset`). It records the semver bump and the
human-readable changelog entry. Reviewers check the bump level against the risk tier in `docs/GOVERNANCE.md`:

- `patch`: fixes, docs, internal refactors with no visual or API change
- `minor`: new component, variant, prop or token (additive)
- `major`: removed or renamed token, prop or component, or a visual change consumers must act on
