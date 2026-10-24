// Studio's side of decision TV-1: when it asks Bridge to arm a token value change, what it sends, and what it says.
import { describe, expect, it } from 'vitest';
import { approvedSaid, askBridgeToShip, shipHeldLine, shouldAskToShip, type ShipAnswer } from './values-ship';
import { jargonIn } from './vocabulary';

const approved = { valuesOnly: true, design: true, changesRequested: [] as string[] };
const base = { approvals: approved, figmaPush: null, state: 'open', draft: false, merged_at: null, autoMerge: false, exploration: false };

describe('shouldAskToShip', () => {
  it('asks for an open token value change with its design approval, not armed yet', () => {
    expect(shouldAskToShip(base)).toBe(true);
  });
  it('never asks otherwise', () => {
    expect(shouldAskToShip({ ...base, approvals: { ...approved, valuesOnly: false } })).toBe(false);
    expect(shouldAskToShip({ ...base, approvals: { ...approved, design: false } })).toBe(false);
    expect(shouldAskToShip({ ...base, approvals: { ...approved, changesRequested: ['malik'] } })).toBe(false);
    expect(shouldAskToShip({ ...base, approvals: null })).toBe(false);
    expect(shouldAskToShip({ ...base, figmaPush: { scope: 'token-values' } })).toBe(false);
    expect(shouldAskToShip({ ...base, autoMerge: true })).toBe(false);
    expect(shouldAskToShip({ ...base, draft: true })).toBe(false);
    expect(shouldAskToShip({ ...base, state: 'closed' })).toBe(false);
    expect(shouldAskToShip({ ...base, merged_at: '2026-10-24' })).toBe(false);
    expect(shouldAskToShip({ ...base, exploration: true })).toBe(false);
  });
});

describe('askBridgeToShip', () => {
  const answer = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  it('sends the GitHub token when the viewer has one, else the member header', async () => {
    const seen: RequestInit[] = [];
    const f = async (_u: string, i: RequestInit) => {
      seen.push(i);
      return new Response(JSON.stringify({ armed: true, route: 'shipped' }), { status: 200 });
    };
    expect(await askBridgeToShip('acme/design', 7, { bearer: 'ghu_x' }, f)).toEqual({ armed: true });
    await askBridgeToShip('acme/design', 7, { bearer: null }, f);
    expect((seen[0]!.headers as Record<string, string>).Authorization).toBe('Bearer ghu_x');
    expect((seen[1]!.headers as Record<string, string>)['X-Bridge-Contribute']).toBe('1');
    expect((seen[1]!.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(JSON.parse(String(seen[0]!.body))).toEqual({ repo: 'acme/design', pr: 7 });
  });

  it('keeps what a held answer says, and reads a refused or failed call as nothing', async () => {
    const held = { armed: false, route: 'waiting-for-developer', code: 'auto_merge_off', reason: 'r', developer: 'Auto-merge is off.' };
    expect(await askBridgeToShip('acme/design', 7, { bearer: 'ghu_x' }, answer(200, held))).toEqual({ armed: false, code: 'auto_merge_off', reason: 'r', developer: 'Auto-merge is off.' });
    expect(await askBridgeToShip('acme/design', 7, { bearer: 'ghu_x' }, answer(401, { error: 'signin' }))).toBeNull();
    expect(await askBridgeToShip('acme/design', 7, { bearer: 'ghu_x' }, answer(200, { nope: 1 }))).toBeNull();
    expect(await askBridgeToShip('acme/design', 7, { bearer: 'ghu_x' }, async () => Promise.reject(new Error('offline')))).toBeNull();
  });
});

describe('what Studio says', () => {
  const armed: ShipAnswer = { armed: true };
  const held: ShipAnswer = { armed: false, code: 'auto_merge_off', developer: 'Auto-merge is off on this repository.' };

  it('after Approve: on its way, added, or just approved (the status says the rest)', () => {
    expect(approvedSaid(armed)).toBe('Approved. It is added to the library once the automatic checks pass.');
    expect(approvedSaid({ armed: true, merged: true })).toBe('Approved and added to the library.');
    expect(approvedSaid(held)).toBe('Approved.');
    expect(approvedSaid(null)).toBe('Approved.');
    for (const s of [approvedSaid(armed), approvedSaid({ armed: true, merged: true }), approvedSaid(held)]) {
      expect(jargonIn(s)).toEqual([]);
      expect(s).not.toMatch(/—/);
    }
  });

  it('the cause, for developers only', () => {
    expect(shipHeldLine(held)).toBe('Bridge could not merge this token value change by itself: auto-merge is off on this repository.');
    expect(shipHeldLine(armed)).toBeNull();
    expect(shipHeldLine(null)).toBeNull();
    expect(shipHeldLine({ armed: false })).toBeNull();
  });
});
