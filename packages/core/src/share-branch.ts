// "Share with a product team" on a branch, shared by Bridge Studio, the MCP server and the CLI: a product team installs the change in its own app before it ships, the
// designer's release candidate. Everything comes from what the Preview packages workflow
// (.github/workflows/preview-packages.yml) really does:
//   - every update to an open or draft change builds the library packages (previews.packages in bridge.config.json)
//     and posts the install command in its sticky comment (`<!-- bridge-branch-preview -->`), about two minutes
//     after the update, whether or not the checks pass;
//   - with pkg.pr.new, one snapshot per update, kept after the change ships or closes;
//   - without it (this repository today), tarballs on a `preview-pr-<n>` GitHub prerelease: only the latest update
//     is kept, and the "Remove the preview prerelease" job deletes it when the change ships or closes.
// Nothing is published to the npm registry per change: there is no dist-tag, the command installs by URL.
import { readPreviewComment } from './previews';

/** The dialog's explanation, in designer words. */
export const SHARE_EXPLAIN = 'Product teams can install this branch in their app before it is merged, and remove it any time.';

export type ChangeLifecycle = 'open' | 'draft' | 'merged' | 'closed';
type Source = 'pkg.pr.new' | 'release' | 'other';

export type ShareState =
  /** The command for the latest update is posted. */
  | { kind: 'ready'; command: string; source: Source }
  /** No command for the latest update yet. */
  | { kind: 'building' }
  /** The workflow posted for the latest update but could not publish. */
  | { kind: 'failed' }
  /** The change touches none of the preview packages: there is nothing to install. */
  | { kind: 'no-packages' }
  /** Shipped or closed. `stillWorks` from where the preview lived; null when no preview was ever posted. */
  | { kind: 'shipped' | 'closed'; stillWorks: boolean | null; command: string | null };

/** `@bridge-ds/react` -> `packages/react/`, the folder the workflow builds it from (PACKAGE_DIRS). */
export const packageDir = (name: string): string => `packages/${name.replace(/^@[^/]+\//, '')}/`;

/** True when a changed file is inside one of the preview packages. */
export function touchesPackages(files: readonly string[], packages: readonly string[]): boolean {
  const dirs = packages.map(packageDir);
  return files.some((f) => dirs.some((d) => f.startsWith(d)));
}

/**
 * Whether a change offers sharing at all: never from a fork (the workflow cannot publish from one) or when the
 * repository has no preview packages configured.
 */
export const canShare = (x: { fromFork: boolean; packages: readonly string[] }): boolean => !x.fromFork && x.packages.length > 0;

/**
 * Where the preview of a change stands, from its lifecycle, its changed files and the sticky preview comment. A
 * comment about an older update than the head means the new one is still being prepared: its command is never shown.
 */
export function shareState(x: { lifecycle: ChangeLifecycle; files: readonly string[]; packages: readonly string[]; comment: string | null | undefined; headSha: string }): ShareState {
  // Checked first: a change outside the packages never has anything to install, before or after it ships.
  if (!touchesPackages(x.files, x.packages)) return { kind: 'no-packages' };
  const c = readPreviewComment(x.comment);
  if (x.lifecycle === 'merged' || x.lifecycle === 'closed') {
    const kind = x.lifecycle === 'merged' ? 'shipped' : 'closed';
    if (!c || !c.command || c.source === 'none') return { kind, stillWorks: null, command: null };
    // pkg.pr.new keeps every snapshot; the prerelease is deleted when the change ships or closes.
    return { kind, stillWorks: c.source === 'pkg.pr.new' ? true : c.source === 'release' ? false : null, command: c.command };
  }
  if (!c) return { kind: 'building' };
  if (c.sha7 && !x.headSha.startsWith(c.sha7)) return { kind: 'building' };
  if (!c.command || c.source === 'none') return { kind: 'failed' };
  return { kind: 'ready', command: c.command, source: c.source };
}

/**
 * Whether the change page shows the action: always while the change is open or a draft (the dialog says why there is
 * nothing to install yet), and after it ships or closes only when a preview was posted that a team may have installed.
 */
export const showShare = (lifecycle: ChangeLifecycle, s: ShareState): boolean =>
  lifecycle === 'open' || lifecycle === 'draft' || ((s.kind === 'shipped' || s.kind === 'closed') && !!s.command);

/** The dialog's description: the explanation while the change can still be tried, where it stands once finished. */
export const shareDescription = (s: ShareState): string =>
  s.kind === 'shipped' || s.kind === 'closed' ? (stateSentence(s) ?? SHARE_EXPLAIN) : SHARE_EXPLAIN;

/** How a product goes back to the released packages. */
export const stableCommand = (packages: readonly string[]): string => `npm i ${packages.map((p) => `${p}@latest`).join(' ')}`;

/** The one sentence the dialog shows under its explanation, in designer words. Null when the message says it all. */
export function stateSentence(s: ShareState): string | null {
  switch (s.kind) {
    case 'ready':
      return null;
    case 'building':
      return 'The preview version is being prepared. It is usually ready a couple of minutes after each update to the branch.';
    case 'failed':
      return 'The preview version could not be prepared for the latest update. Update the branch to try again, or ask a developer to run it again on GitHub.';
    case 'no-packages':
      return 'This branch does not touch the library tokens or components, so there is no preview version to install.';
    case 'shipped':
      return s.stillWorks === true
        ? 'This branch was merged. Its preview version still installs, and products get it with the next library release.'
        : s.stillWorks === false
          ? 'This branch was merged, so its preview version was removed. Products get it with the next library release.'
          : 'This branch was merged. Products get it with the next library release.';
    case 'closed':
      return s.stillWorks === true
        ? 'This branch was closed without merging. Its preview version still installs, but it will not reach the library.'
        : s.stillWorks === false
          ? 'This branch was closed without merging, so its preview version was removed.'
          : 'This branch was closed without merging.';
  }
}

export interface ShareMessageInput {
  title: string;
  state: ShareState;
  packages: readonly string[];
  /** "Try it in the product": the admin preview with this change, when GitHub reports one. */
  tryUrl?: string | null | undefined;
  /** The change on GitHub, for the developer. */
  url: string;
}

export interface ShareMessage {
  subject: string;
  body: string;
}

const quote = (t: string) => `"${t.trim().replace(/"/g, "'")}"`;

/**
 * The ready-to-paste message for a developer of a product team: the change, the preview install command, where to
 * see it first, how long the preview lasts and how to go back. Plain text, for a chat or an email. Null when there is
 * nothing to install and nothing to undo (still building, failed, no packages, or never posted).
 */
export function shareMessage(x: ShareMessageInput): ShareMessage | null {
  const back = stableCommand(x.packages);
  const s = x.state;
  if (s.kind === 'ready') {
    const lasts =
      s.source === 'pkg.pr.new'
        ? 'This preview stays available. Each update to the change makes a new one: ask me for the latest command.'
        : 'This preview is replaced on each update to the change and removed when it ships or closes: ask me for the latest command if the install fails.';
    return {
      subject: `Try the design system change ${quote(x.title)} before it ships`,
      body: [
        'Hi,',
        '',
        `Could you try the design system change ${quote(x.title)} in our product before it ships?`,
        ...(x.tryUrl ? ['', `See it in the demo product first: ${x.tryUrl}`] : []),
        '',
        'Install the preview version in a staging branch (not production):',
        s.command,
        '',
        lasts,
        '',
        'To go back to the stable version:',
        back,
        '',
        `Details for developers: ${x.url}`,
      ].join('\n'),
    };
  }
  if ((s.kind === 'shipped' || s.kind === 'closed') && s.command) {
    const what = s.kind === 'shipped' ? `The design system change ${quote(x.title)} has shipped. You get it with the next library release.` : `The design system change ${quote(x.title)} was closed without shipping.`;
    const preview = s.stillWorks === false ? 'Its preview version was removed, so reinstalling it fails.' : s.stillWorks === true ? 'Its preview version still installs, but it is not the released version.' : '';
    return {
      subject: `Design system change ${quote(x.title)} ${s.kind === 'shipped' ? 'has shipped' : 'was closed'}`,
      body: ['Hi,', '', [what, preview].filter(Boolean).join(' '), '', 'If you installed its preview, go back to the stable version:', back, '', `Details for developers: ${x.url}`].join('\n'),
    };
  }
  return null;
}

/** "Open in email": a mailto link with the subject and body. Nothing is sent by Studio. */
export const mailtoHref = (m: ShareMessage): string => `mailto:?subject=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(m.body.replace(/\r?\n/g, '\r\n'))}`;
