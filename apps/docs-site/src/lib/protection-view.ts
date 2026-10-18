// Settings > Protection and the Overview line: what the row says and offers for each protection state, in designer
// words. "Ruleset", "branch" and "force push" appear only in the dialog's "Details for developers".
import { ghAction } from './gh-wording';
import { protectionRulesetName, protectionSentence, type ProtectionState } from '@bridge-ds/core';

export type ProtectionRowState = ProtectionState | { kind: 'loading' | 'no-token' };

export interface ProtectionRowView {
  /** The one sentence on the row. */
  text: string;
  /** The row's one action, when the viewer can act on it. */
  action?: 'Protect the library' | 'Complete protection';
  /** A quiet link on the row (protected: where the rule lives on GitHub). */
  link?: { label: string; href: string };
}

export function protectionRow(state: ProtectionRowState, rulesUrl: string, signIn = false): ProtectionRowView {
  switch (state.kind) {
    case 'loading':
      return { text: 'Checking whether every change goes through review.' };
    case 'no-token':
      return { text: `${ghAction('see whether every change goes through review', signIn)}.` };
    case 'unknown':
      return { text: 'GitHub did not let this token read the protection. A repository admin can see it in GitHub settings.' };
    case 'protected':
      return { text: protectionSentence(state), link: { label: 'View on GitHub', href: state.url ?? rulesUrl } };
    case 'unprotected':
      return { text: protectionSentence(state), action: 'Protect the library' };
    case 'partial':
      return { text: protectionSentence(state), action: 'Complete protection' };
  }
}

/** The Overview line, for owners only and only when nothing protects the library. Null otherwise. */
export function overviewProtectionLine(state: ProtectionRowState, isOwner: boolean): string | null {
  return isOwner && state.kind === 'unprotected' ? 'Your library can be changed without review. Protect it in Settings.' : null;
}

/** The dialog's "Details for developers": what GitHub gets, in GitHub's words. */
export function protectionDetails(defaultBranch: string, checks: string[]): string[] {
  return [
    `Creates the repository ruleset "${protectionRulesetName(defaultBranch)}" on the default branch (${defaultBranch}).`,
    'Blocks deleting the branch and force pushes.',
    'Requires a pull request with 1 approval; a new push dismisses earlier approvals.',
    checks.length ? `Requires these status checks: ${checks.join(', ')}.` : 'Requires no status checks: none ran on recent pull requests.',
    'Bypass: the Admin role, for pull requests only. Nobody can push to the branch directly.',
  ];
}
