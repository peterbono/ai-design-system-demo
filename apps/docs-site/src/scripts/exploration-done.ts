// "Done exploring" from an exploration page or a product branch page: opens the DS Dialog
// (components/ds/studio/DoneExploring.tsx) with the pieces the last check found, then runs the core call with the
// viewer's token. The ticked pieces go to the DS lead as requests with the preview link, the branch goes to the
// developers, nothing closes. No React here: the dialog is its own island, reached by an event.
import { doneExploringOnGitHub, type GitHubClient, type ProductConfig } from '@bridge-ds/core';
import { doneLine, donePieces } from '../lib/explorations-view';
import type { DoneExploringDetail } from '../components/ds/studio/DoneExploring';
import { currentViewer } from './github-session';

export const DONE_EXPLORING_EVENT = 'bridge:done-exploring-ask';

export function askDoneExploring(
  r: { number: number; name: string },
  body: string | null | undefined,
  opts: {
    client: () => GitHubClient;
    /**
     * The design system repository, when the exploration lives in a product's own one (`client` writes that one): the
     * ticked pieces are filed there as requests, where the DS lead works.
     */
    library?: () => GitHubClient;
    previewUrl: string | null;
    products?: readonly ProductConfig[];
    after: (line: string) => void;
    focus?: HTMLElement | null;
  },
) {
  const found = donePieces(body);
  const detail: DoneExploringDetail = {
    number: r.number,
    name: r.name,
    pieces: found.pieces,
    checked: found.checked,
    sent: found.sent,
    confirm: async (pieces) => {
      const viewer = currentViewer()?.login;
      const res = await doneExploringOnGitHub(opts.client(), r.number, { pieces, products: opts.products ?? [], previewUrl: opts.previewUrl, ...(viewer ? { openedBy: viewer } : {}), ...(opts.library ? { library: opts.library() } : {}), source: 'studio' });
      opts.after(`${doneLine(res.pieces.proposed.length)}${res.warnings.length ? ` ${res.warnings.join(' ')}` : ''}`);
    },
    closed: (done) => {
      if (!done && opts.focus?.isConnected) opts.focus.focus();
    },
  };
  document.dispatchEvent(new CustomEvent(DONE_EXPLORING_EVENT, { detail }));
}
