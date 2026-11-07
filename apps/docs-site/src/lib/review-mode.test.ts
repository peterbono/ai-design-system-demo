import { describe, expect, it, vi } from 'vitest';
import { askedToReview, decidesOnExplorations, needsReview } from '../../api/_lib/review-mode';
import { addsLeadWords } from '../../api/_lib/lead-gate';
import { GUARD_COMMENT, guardCaseOf, runLeadGuard, senderDecides } from '../../api/_lib/lead-guard';
import { goesThroughReview, pmGateStop } from '../scripts/exploration-done';

const lead = { role: 'edit' as const, lead: true };
const designer = { role: 'edit' as const };
const viewer = { role: 'view' as const };
const admin = { role: 'admin' as const };

describe('who looks after the design system', () => {
  it('one person: the design leads are asked; an admin decides and is never asked', () => {
    expect(askedToReview(lead, 'one')).toBe(true);
    expect(askedToReview(designer, 'one')).toBe(false);
    expect(askedToReview(admin, 'one')).toBe(false);
    expect(decidesOnExplorations(admin, 'one')).toBe(true);
    expect(decidesOnExplorations(designer, 'one')).toBe(false);
  });
  it('shared with review: every designer is asked, a viewer never', () => {
    expect(askedToReview(designer, 'shared')).toBe(true);
    expect(askedToReview(viewer, 'shared')).toBe(false);
    expect(decidesOnExplorations(viewer, 'shared')).toBe(false);
  });
  it('a review exists when someone other than the author is asked, never with "Shared, no review"', () => {
    expect(needsReview({ mode: 'one', designOwners: 0, members: [designer] })).toBe(false);
    expect(needsReview({ mode: 'one', designOwners: 0, members: [lead] })).toBe(true);
    expect(needsReview({ mode: 'one', designOwners: 1, members: [] })).toBe(true);
    // An admin alone does not make a lead step: they are never asked.
    expect(needsReview({ mode: 'one', designOwners: 0, members: [admin] })).toBe(false);
    expect(needsReview({ mode: 'shared', designOwners: 0, members: [designer] })).toBe(true);
    expect(needsReview({ mode: 'shared-none', designOwners: 3, members: [lead] })).toBe(false);
  });
  it("I'll look is a reviewer's word", () => {
    const b = (e: Record<string, unknown>) =>
      `x\n<!-- bridge-exploration ${JSON.stringify({
        name: 'Orders',
        leadAskedAt: 'a',
        ...e,
      })} -->`;
    expect(
      addsLeadWords(b({}), b({ leadTakenAt: 't', leadTakenByName: 'Ann' }), {
        hasLeads: true,
      }),
    ).toBe(true);
  });
});

describe('Done exploring in Studio', () => {
  const base = {
    viewer: null,
    author: null,
    leads: [] as string[],
    me: 'aaaaaaaaaaaaaaaa',
    authorRef: 'aaaaaaaaaaaaaaaa',
  };
  it('goes to an email lead other than the author', () => {
    expect(
      goesThroughReview({
        ...base,
        review: {
          mode: 'one',
          asked: [{ ref: 'bbbbbbbbbbbbbbbb', name: 'Dino' }],
        },
      }),
    ).toBe(true);
    expect(
      goesThroughReview({
        ...base,
        review: {
          mode: 'one',
          asked: [{ ref: 'aaaaaaaaaaaaaaaa', name: 'Me' }],
        },
      }),
    ).toBe(false);
  });
  it('goes to a design owner, as before, and never with "Shared, no review"', () => {
    expect(
      goesThroughReview({
        ...base,
        viewer: 'ann',
        author: 'ann',
        leads: ['flo'],
        review: { mode: 'one', asked: [] },
      }),
    ).toBe(true);
    expect(
      goesThroughReview({
        ...base,
        viewer: 'ann',
        author: 'ann',
        leads: ['flo'],
        review: { mode: 'shared-none', asked: [{ ref: 'b', name: 'B' }] },
      }),
    ).toBe(false);
  });
});

const edit = (
  e: {
    sender?: Record<string, unknown>;
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
  } = {},
) => ({
  action: 'edited',
  repository: { full_name: 'Acme/Shop-Design' },
  sender: { login: 'Dev', type: 'User', ...e.sender },
  changes: {
    body: {
      from: `x\n<!-- bridge-exploration ${JSON.stringify({
        name: 'Orders',
        leadAskedAt: 'a',
        author: 'ann',
        ...e.before,
      })} -->`,
    },
  },
  pull_request: {
    number: 7,
    user: { login: 'ann' },
    body: `x\n<!-- bridge-exploration ${JSON.stringify({
      name: 'Orders',
      leadAskedAt: 'a',
      author: 'ann',
      ...(e.after ?? {
        decisions: [{ kind: 'looks-right', at: 't', round: 1, by: 'dev' }],
      }),
    })} -->`,
  },
});

describe('the lead guard on GitHub edits', () => {
  it('looks at a person adding a lead word, never at a bot or a plain edit', () => {
    expect(guardCaseOf('pull_request', edit())).toMatchObject({
      repo: 'acme/shop-design',
      number: 7,
      sender: 'dev',
      authors: ['ann'],
    });
    expect(guardCaseOf('pull_request', edit({ sender: { type: 'Bot' } }))).toBeNull();
    expect(guardCaseOf('pull_request', edit({ after: { reopenedAt: 'y' } }))).toBeNull();
    expect(guardCaseOf('issues', edit())).toBeNull();
  });
  it('a design owner or an admin may decide, never on their own exploration', () => {
    const g = guardCaseOf('pull_request', edit())!;
    expect(senderDecides(g, { designOwners: ['@Dev'], admin: false })).toBe(true);
    expect(senderDecides(g, { designOwners: [], admin: true })).toBe(true);
    expect(senderDecides(g, { designOwners: [], admin: false })).toBe(false);
    expect(senderDecides({ ...g, sender: 'ann' }, { designOwners: ['ann'], admin: true })).toBe(false);
  });
  it('puts the description back and says why once', async () => {
    const call = vi.fn(async (_repo: string, method: string, _path: string, _body?: unknown) => (method === 'GET' ? { status: 200, data: { permission: 'write' } } : { status: 200, data: {} }));
    expect(
      await runLeadGuard('pull_request', edit(), {
        call,
        designOwners: async () => ['flo'],
      }),
    ).toBe(true);
    const patch = call.mock.calls.find((c) => c[1] === 'PATCH')!;
    expect(patch[2]).toBe('/repos/acme/shop-design/pulls/7');
    expect((patch[3] as { body: string }).body).toContain('"author":"ann"');
    expect((patch[3] as { body: string }).body).not.toContain('looks-right');
    expect(call.mock.calls.find((c) => c[1] === 'POST')![3]).toEqual({
      body: `@dev ${GUARD_COMMENT}`,
    });
  });
  it('leaves an admin or a design owner alone', async () => {
    const call = vi.fn(async () => ({
      status: 200,
      data: { permission: 'admin' },
    }));
    expect(
      await runLeadGuard('pull_request', edit(), {
        call,
        designOwners: async () => [],
      }),
    ).toBe(false);
    expect(call).toHaveBeenCalledTimes(1);
  });
});

describe('the PM gate at Done exploring', () => {
  const pms = { shop: { name: 'Dino', ref: 'cccccccccccccccc' } };
  const said = (kind: string) => `x\n<!-- bridge-exploration ${JSON.stringify({ name: 'Orders', decisions: [{ kind, at: 't', round: 1, byName: 'Dino' }] })} -->`;
  it('"Shared, no review" waits for the PM, a product with no PM goes on', () => {
    const review = { mode: 'shared-none' as const, asked: [], pms };
    expect(pmGateStop({ review, throughReview: false, product: 'shop', body: 'x' })).toMatch(/Dino says it looks good/);
    expect(pmGateStop({ review, throughReview: false, product: 'shop', body: said('pm-changes') })).toMatch(/Dino asked for changes/);
    expect(pmGateStop({ review, throughReview: false, product: 'shop', body: said('pm-ok') })).toBeNull();
    expect(pmGateStop({ review, throughReview: false, product: 'shop', body: said('pm-call') })).toBeNull();
    expect(pmGateStop({ review, throughReview: false, product: 'other', body: 'x' })).toBeNull();
  });
  it('the only designer waits for the PM too; a team with a review does not', () => {
    expect(pmGateStop({ review: { mode: 'one', asked: [], pms }, throughReview: false, product: 'shop', body: 'x' })).not.toBeNull();
    expect(pmGateStop({ review: { mode: 'one', asked: [], pms }, throughReview: true, product: 'shop', body: 'x' })).toBeNull();
  });
});
