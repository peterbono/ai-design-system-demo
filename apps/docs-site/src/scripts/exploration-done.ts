// "Done exploring" from an exploration page or a product branch page: opens the DS Dialog
// (components/ds/studio/DoneExploring.tsx) with the pieces the last check found, then runs the core call with the
// viewer's token. The ticked pieces go to the DS lead as requests with the preview link, the branch goes to the
// developers, nothing closes. No React here: the dialog is its own island, reached by an event.
import { askLeadOnGitHub, doneExploringOnGitHub, needsLeadValidation, parseExplorationBody, pmOpinionOf, type GitHubClient, type ProductConfig } from '@bridge-ds/core';
import { pmRequired } from '../lib/pm-view';
import { doneLine, donePieces, leadAskedLine } from '../lib/explorations-view';
import type { DoneExploringDetail } from '../components/ds/studio/DoneExploring';
import { currentContributor, currentViewer, getToken, readRepo } from './github-session';
import { siteApprovers } from './teams';
import { teamReview, type TeamReview } from './contribute-session';
import { checkPieces } from './connector-api';

export const DONE_EXPLORING_EVENT = 'bridge:done-exploring-ask';

/**
 * Whether Done exploring goes through a review first, by the team's setting (api/_lib/review-mode.ts): never with
 * "Shared, no review", else when someone other than the viewer and the author is asked: a design owner (core
 * needsLeadValidation) or an email member asked to review. Nobody else: straight to the developers, or it would wait
 * forever.
 */
export function goesThroughReview(x: { review: TeamReview; viewer: string | null; author: string | null | undefined; leads: readonly string[]; me: string | null; authorRef: string | null }): boolean {
  if (x.review.mode === 'shared-none') return false;
  if (needsLeadValidation({ viewer: x.viewer, author: x.author, leads: x.leads })) return true;
  return x.review.asked.some((a) => a.ref !== x.me && a.ref !== x.authorRef);
}

/**
 * The PM gate (board R1, lib/pm-view pmRequired): with "Shared, no review", or when nobody but the author could review
 * (the only designer), the product's PM must say Looks good (or have agreed in a call) before the developers. A product
 * with no PM set skips it.
 */
export function pmGateRequired(x: { review: TeamReview; throughReview: boolean }): boolean {
  return pmRequired({ review: x.review.mode === 'shared' ? 'shared-review' : x.review.mode, designers: x.throughReview ? null : 1 });
}

/** What stops Done exploring at the PM gate: the sentence to show, or null when it may go. */
export function pmGateStop(x: { review: TeamReview; throughReview: boolean; product: string | null | undefined; body: string | null | undefined }): string | null {
  if (x.throughReview || !pmGateRequired(x)) return null;
  const pm = x.product ? x.review.pms?.[x.product] : undefined;
  if (!pm) return null;
  const said = pmOpinionOf(x.body)?.kind;
  if (said === 'pm-ok' || said === 'pm-call') return null;
  return said === 'pm-changes' ? `${pm.name} asked for changes. Answer them first: nothing goes to the developers before ${pm.name} says it looks good.` : `Share it with ${pm.name} first: nothing goes to the developers before ${pm.name} says it looks good.`;
}

export function askDoneExploring(
  r: { number: number; name: string; author?: string | null; product?: string | null },
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
    /**
     * Never checked: run the library check while the dialog is open. `repo` is the design system repository the
     * server checks from, `ref` the exploration ("12", "shop#12"), `body` reads its description again afterwards.
     */
    check?: { repo: string; ref: string; body: () => Promise<string | null | undefined> } | null;
  },
) {
  const found = donePieces(body);
  const who0 = currentViewer();
  const viewer = who0 && !who0.email ? who0.login : null;
  const leads = siteApprovers().design;
  const repo = readRepo();
  const me = currentContributor()?.ref ?? null;
  const authorRef = parseExplorationBody(body)?.member;
  // A reviewer validates first, by the team's setting: nothing reaches the developers before they answer.
  void teamReview(`${repo.owner}/${repo.repo}`, currentContributor() ? null : getToken()).then((review) => {
    const through = goesThroughReview({ review, viewer, author: r.author, leads, me, authorRef: typeof authorRef === 'string' ? authorRef : null });
    open(through, pmGateStop({ review, throughReview: through, product: r.product, body }));
  });
  function open(viaLead: boolean, pmStop: string | null) {
  const detail: DoneExploringDetail = {
    number: r.number,
    name: r.name,
    pieces: found.pieces,
    checked: found.checked,
    sent: found.sent,
    viaLead,
    confirm: async (pieces) => {
      // The PM gate: with no review, the product's PM says it looks good before the developers.
      if (pmStop) throw new Error(pmStop);
      // A member who joined by email is named by their display name in the developers' task, never by their email.
      const v = currentViewer();
      const who = v ? (v.email ? { openedByName: v.name?.trim() || 'a designer' } : { openedBy: v.login }) : {};
      if (viaLead) {
        await askLeadOnGitHub(opts.client(), r.number, { pieces, ...who, leads: leads.filter((l) => !l.includes('/') && l.toLowerCase() !== viewer?.toLowerCase()) });
        opts.after(leadAskedLine(pieces.length));
        return;
      }
      const res = await doneExploringOnGitHub(opts.client(), r.number, { pieces, products: opts.products ?? [], previewUrl: opts.previewUrl, ...who, ...(opts.library ? { library: opts.library() } : {}), source: 'studio' });
      // The designer reads what happened to their pieces; GitHub housekeeping (a label, the note) is for developers.
      const other = res.warnings.filter((w) => !res.pieces.warnings.includes(w));
      if (other.length) console.warn(`Done exploring #${r.number}: ${other.join(' ')}`);
      opts.after(`${doneLine(res.pieces.proposed.length)}${res.pieces.warnings.length ? ` ${res.pieces.warnings.join(' ')}` : ''}`);
    },
    closed: (done) => {
      if (!done && opts.focus?.isConnected) opts.focus.focus();
    },
    check: opts.check
      ? async () => {
          const c = opts.check!;
          const r = await checkPieces(c.repo, c.ref).catch(() => null);
          if (!r) return null;
          const after = donePieces(await c.body().catch(() => null));
          if (after.checked) return after;
          // Checked, nothing missing: the server's answer is enough, even when GitHub still serves the description
          // from before the check.
          return r.checked && r.pieces === 0 ? { checked: true, pieces: [], sent: 0 } : null;
        }
      : null,
  };
  document.dispatchEvent(new CustomEvent(DONE_EXPLORING_EVENT, { detail }));
  }
}
