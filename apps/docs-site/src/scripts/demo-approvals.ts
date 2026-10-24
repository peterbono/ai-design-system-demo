// Approve tried on the sample team (Acme Design), remembered for the visit in this browser (lib/demo.ts
// DEMO_APPROVED_KEY): the branch review shows Approved again, and the demo home, the queue and Branches > Waiting on
// me leave it out. scripts/demo-drafts.ts drops it when the visitor leaves the sample team. Nothing is sent anywhere.
import { demoApprovedSet, markDemoApproved } from '../lib/demo';

/** The sample team's branches approved during this visit (empty when storage is blocked). */
export function demoApprovals(): Set<number> {
  try {
    return demoApprovedSet(localStorage);
  } catch {
    return new Set();
  }
}

/** Remembers (or, for Undo, forgets) a branch approved on the sample team. */
export function rememberDemoApproval(pr: number, approved = true): void {
  try {
    markDemoApproved(localStorage, pr, approved);
  } catch {
    /* storage blocked: the approval lives on this page only */
  }
}
