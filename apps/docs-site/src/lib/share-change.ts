// "Share with a product team" on a change: a product team installs the change in its own app before it ships, the
// designer's release candidate. Everything comes from what the Preview packages workflow
// (.github/workflows/preview-packages.yml) really does:
//   - every update to an open or draft change builds the library packages (previews.packages in bridge.config.json)
//     and posts the install command in its sticky comment (`<!-- bridge-branch-preview -->`), about two minutes
//     after the update, whether or not the checks pass;
//   - with pkg.pr.new, one snapshot per update, kept after the change ships or closes;
//   - without it (this repository today), tarballs on a `preview-pr-<n>` GitHub prerelease: only the latest update
//     is kept, and the "Remove the preview prerelease" job deletes it when the change ships or closes.
// Nothing is published to the npm registry per change: there is no dist-tag, the command installs by URL.
// The rules and words live in @bridge-ds/core (share-branch.ts), shared with the MCP server and the CLI.
export {
  SHARE_EXPLAIN as EXPLAIN,
  packageDir,
  touchesPackages,
  canShare,
  shareState,
  showShare,
  shareDescription,
  stableCommand,
  stateSentence,
  shareMessage,
  mailtoHref,
  type ChangeLifecycle,
  type ShareState,
  type ShareMessageInput,
  type ShareMessage,
} from '@bridge-ds/core';
