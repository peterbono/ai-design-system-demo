// Approve and Decline on a join request (board E7b), shared by the Home rows and the Review page's queue card: the
// same calls (scripts/entry-session), the same words (lib/entry ENTRY_WORDS).
import type { JoinHandlers } from '../components/ds/studio/NeedRows';
import { ENTRY_WORDS } from '../lib/entry';

/**
 * Approve and Decline on a join request (board E7b). After a decision the row goes at once (`onGone`) and the home
 * recounts; the toast says what happened, with Undo for a short while: the request comes back (`onBack`). An account
 * without a GitHub admin linked gets "Connect GitHub to manage requests", never the refusal.
 */
export function joinHandlers(repo: () => string, onGone: (key: string) => void, onBack: (key: string) => void = () => undefined): JoinHandlers {
  return {
    decide: async (row, approve) => {
      const id = row.request?.id;
      const name = row.request?.name ?? row.title;
      if (!id) return { ok: false, github: false, text: ENTRY_WORDS.githubToManage };
      const api = await import('./entry-session');
      try {
        if (approve) await api.approveRequest(repo(), id);
        else await api.declineRequest(repo(), id);
        onGone(row.key);
        return { ok: true, undo: true, text: approve ? ENTRY_WORDS.joined(name) : ENTRY_WORDS.declined(name) };
      } catch (err) {
        if (api.needsGitHubAdmin(err)) return { ok: false, github: true, text: ENTRY_WORDS.githubToManage };
        // Already answered or expired: the row goes, like after a decision.
        if (err instanceof api.EntryError && err.status === 404) {
          onGone(row.key);
          return { ok: true, text: err.message };
        }
        return { ok: false, github: false, text: err instanceof Error ? err.message : '' };
      }
    },
    undo: async (row) => {
      const id = row.request?.id;
      const name = row.request?.name ?? row.title;
      if (!id) return { ok: false, github: false, text: '' };
      const api = await import('./entry-session');
      try {
        await api.undoDecision(repo(), id);
        onBack(row.key);
        return { ok: true, text: ENTRY_WORDS.undone(name) };
      } catch (err) {
        return { ok: false, github: api.needsGitHubAdmin(err), text: err instanceof Error ? err.message : '' };
      }
    },
    connectGitHub: () => {
      void import('./account-session').then(({ linkGitHub }) => linkGitHub(location.pathname + location.search));
    },
  };
}

