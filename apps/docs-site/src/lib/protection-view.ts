// Settings > Protection and the Overview line: what the row says and offers for each protection state, in designer
// words. GitHub's own terms (ruleset, force push, status checks) stay on GitHub: the dialog links to how it works there.
import { ghAction } from './gh-wording';
import { VOCAB } from './vocabulary';
import { protectionSentence, type ProtectionState } from '@bridge-ds/core';

/** GitHub's page on rulesets, the "How it works on GitHub" link of the protection dialog. */
export const RULESETS_HELP_URL = 'https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets';

export type ProtectionRowState = ProtectionState | { kind: 'loading' | 'no-token' };

export interface ProtectionRowView {
  /** The one sentence on the row. */
  text: string;
  /** The row's one action, when the viewer can act on it. */
  action?: 'Protect the library' | 'Complete protection';
  /** A quiet link on the row (protected: where the rule lives on GitHub). */
  link?: { label: string; href: string };
}

/** What a viewer who is not a GitHub admin of the library reads instead of the action they could not take. */
export const PROTECT_ADMIN_ONLY = 'Only a GitHub admin of the library can turn this on.';

/**
 * The Protection row. `admin`: GitHub says whether the viewer administers the repository (null: not known). Not an
 * admin: no action, the sentence says who can (BR-20), instead of a refusal after the confirmation.
 */
export function protectionRow(state: ProtectionRowState, rulesUrl: string, signIn = false, admin: boolean | null = null): ProtectionRowView {
  const view = rowFor(state, rulesUrl, signIn);
  if (admin === false && view.action) return { text: `${view.text} ${PROTECT_ADMIN_ONLY}` };
  return view;
}

function rowFor(state: ProtectionRowState, rulesUrl: string, signIn: boolean): ProtectionRowView {
  switch (state.kind) {
    case 'loading':
      return { text: 'Checking whether every change goes through review.' };
    case 'no-token':
      return { text: `${ghAction('see whether every change goes through review', signIn)}.` };
    case 'unknown':
      return { text: 'Studio cannot see whether every change goes through review with your GitHub access. A GitHub admin of the library can see it.' };
    case 'protected':
      return { text: protectionSentence(state), link: { label: VOCAB.openOnGitHub, href: state.url ?? rulesUrl } };
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
