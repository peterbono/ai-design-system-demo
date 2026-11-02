import { describe, expect, it } from 'vitest';
import { parseExplorationBody, withDoneExploring } from '@bridge-ds/core';
import { memberRef, withMemberInBlock } from '../../api/_lib/exploration-member';
import { isOwnExploration } from './home-explorations';

const block = (e: Record<string, unknown>) => `Why\n\n<!-- bridge-exploration ${JSON.stringify(e)} -->\n\nRequested by Dino through Bridge.`;

describe('an email member in the exploration block', () => {
  const ref = memberRef('Dino@yopmail.com ');
  it('is a stable 16 hex reference, the same for any spelling of the email', () => {
    expect(ref).toMatch(/^[0-9a-f]{16}$/);
    expect(memberRef('dino@yopmail.com')).toBe(ref);
    expect(memberRef('other@yopmail.com')).not.toBe(ref);
  });
  it('replaces the email with the reference and the name, never keeps the email', () => {
    const out = withMemberInBlock(block({ name: 'toast', purpose: '', author: 'dino@yopmail.com', doneAt: '2026-11-02T01:40:45.516Z', doneBy: 'dino@yopmail.com' }), { ref, name: 'Dino' });
    expect(out).not.toContain('yopmail');
    const e = parseExplorationBody(out)!;
    expect(e).toMatchObject({ name: 'toast', member: ref, memberName: 'Dino', doneByMember: ref });
    expect(e.author).toBeUndefined();
    expect(e.doneBy).toBeUndefined();
    expect(out.startsWith('Why\n\n')).toBe(true);
    expect(out.endsWith('Requested by Dino through Bridge.')).toBe(true);
  });
  it('keeps who started it once set, and a body without a block as it is', () => {
    const first = withMemberInBlock(block({ name: 'toast', purpose: '' }), { ref, name: 'Dino' });
    const again = withMemberInBlock(first, { ref: memberRef('lead@acme.com'), name: 'Lead' });
    expect(parseExplorationBody(again)?.member).toBe(ref);
    expect(withMemberInBlock('Plain body', { ref, name: 'Dino' })).toBe('Plain body');
  });
  it('survives core rewriting the block (Done exploring), and Home finds it as theirs', () => {
    const body = withMemberInBlock(block({ name: 'toast', purpose: '', slug: 'toast' }), { ref, name: 'Dino' });
    const done = withDoneExploring(body, { branch: 'explore/toast', doneAt: '2026-11-02T01:00:00.000Z' });
    expect(parseExplorationBody(done)).toMatchObject({ member: ref, memberName: 'Dino' });
    const p = { user: { login: 'bridge-design-studio[bot]' }, body: done } as never;
    expect(isOwnExploration(p, 'dino@yopmail.com', ref)).toBe(true);
    expect(isOwnExploration(p, 'someone@else.com', memberRef('someone@else.com'))).toBe(false);
  });
  it('still matches an older block that carried the email as author', () => {
    const p = { user: { login: 'bridge-design-studio[bot]' }, body: block({ name: 'old', purpose: '', author: 'dino@yopmail.com' }) } as never;
    expect(isOwnExploration(p, 'dino@yopmail.com', ref)).toBe(true);
  });
});
