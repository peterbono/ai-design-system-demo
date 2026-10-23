import { describe, expect, it } from 'vitest';
import { askDirectInstallMessage, DIRECT_CONSENT, DIRECT_SETUP, directSetupLine, ghAction, ghButton, ghVerb, notSentLine, rateLimitedLine, SEE_SUGGESTION, SENT_FOR_REVIEW, sendButton, sendDialogTitle, sendGoal, sendingLine, SUGGEST_NEXT, suggestionSentLine, SUGGESTION_SENT, suggestOnlyLine } from './gh-wording';

describe('gh-wording', () => {
  it('says Sign in when the site has a GitHub App', () => {
    expect(ghVerb(true)).toBe('Sign in');
    expect(ghVerb(true, true)).toBe('Sign in again');
    expect(ghAction('send', true)).toBe('Sign in to send');
    expect(ghAction('propose', true, true)).toBe('Sign in again to propose');
    expect(ghButton(true)).toBe('Sign in with GitHub');
  });

  it('keeps Connect GitHub for the token paste', () => {
    expect(ghVerb(false)).toBe('Connect GitHub');
    expect(ghVerb(false, true)).toBe('Reconnect GitHub');
    expect(ghAction('send', false)).toBe('Connect GitHub to send');
    expect(ghAction('propose', false, true)).toBe('Reconnect GitHub to propose');
    expect(ghButton(false)).toBe('Connect GitHub');
  });

  it('words the rate limit for each way in', () => {
    expect(rateLimitedLine(true)).toBe('GitHub limits anonymous reads to 60 an hour and this browser has used them. Sign in, or try again later.');
    expect(rateLimitedLine(false)).toMatch(/Connect GitHub, or try again later\.$/);
  });
});

describe('send words per mode', () => {
  it('says suggestion in suggest mode, never issue', () => {
    expect(sendButton('tokens', 'suggest')).toBe('Send suggestion');
    expect(sendButton('piece', 'suggest')).toBe('Send suggestion');
    expect(sendButton('docs', 'suggest')).toBe('Send suggestion');
    expect(sendGoal('tokens', 'suggest')).toBe('send a suggestion');
    expect(ghAction(sendGoal('brand', 'suggest'), true)).toBe('Sign in to send a suggestion');
    expect(sendDialogTitle('suggest')).toBe('Send a suggestion');
    expect(sendingLine('suggest')).toBe('Sending your suggestion');
    expect(suggestionSentLine(42)).toBe('Suggestion #42 sent to your DS lead. A developer applies it once it is approved.');
    expect(notSentLine('suggest', 'no access.')).toBe('Not sent: no access.');
    const all = [SUGGEST_NEXT, SUGGESTION_SENT, SEE_SUGGESTION, suggestOnlyLine('add to branches', 'Send it as a suggestion.'), ...(['tokens', 'piece', 'docs', 'brand', 'revert'] as const).flatMap((w) => [sendButton(w, 'suggest'), sendGoal(w, 'suggest')])];
    for (const line of all) {
      expect(line).not.toMatch(/\bissue|pull request|commit\b/i);
      expect(line).not.toContain(String.fromCharCode(0x2014));
    }
  });

  it('says one verb in direct mode, never branch words', () => {
    for (const w of ['tokens', 'piece', 'docs', 'brand', 'revert'] as const) {
      expect(sendButton(w, 'direct')).toBe('Send for review');
      expect(sendButton(w, 'suggest')).toBe('Send suggestion');
      expect(sendGoal(w, 'direct')).toBe('send it for review');
    }
    expect(ghAction(sendGoal('brand', 'direct'), true)).toBe('Sign in to send it for review');
    expect(sendDialogTitle('direct')).toBe('Send for review');
    expect(sendingLine('direct')).toBe('Sending it for review');
    expect(SENT_FOR_REVIEW).toBe('Sent for review');
    expect(notSentLine('direct', 'no access.')).toBe('Not sent: no access.');
    for (const line of [sendDialogTitle('direct'), sendingLine('direct'), sendGoal('tokens', 'direct')]) expect(line).not.toMatch(/branch|pull request|commit/i);
  });

  it('says why a branch action is not offered', () => {
    expect(suggestOnlyLine('add to branches')).toBe('This design system takes suggestions, so Bridge does not add to branches here.');
    expect(suggestOnlyLine('add to branches', 'Send your edits as a suggestion instead.')).toBe('This design system takes suggestions, so Bridge does not add to branches here. Send your edits as a suggestion instead.');
  });
});

describe('saving to branches on a team page (Bridge Direct)', () => {
  const all = [...Object.values(DIRECT_CONSENT).filter((v) => typeof v === 'string'), ...DIRECT_CONSENT.can, ...Object.values(DIRECT_SETUP), DIRECT_CONSENT.otherAccount('ann', 'bob'), directSetupLine('acme/ds', true), directSetupLine('acme/ds', false)];

  it('speaks to designers: no jargon, no em dash', () => {
    for (const line of all) {
      expect(line).not.toMatch(/\u2014|oauth|token|scope|pull request|permission|repositor/i);
    }
  });

  it('tells admins to install it and everyone else to ask their lead', () => {
    expect(directSetupLine('acme/ds', true)).toMatch(/Install Bridge Direct on GitHub, pick ds/);
    expect(directSetupLine('acme/ds', false)).toMatch(/^Your lead needs/);
    expect(DIRECT_SETUP.installLabel).toBe('Install Bridge Direct');
    expect(DIRECT_SETUP.askLabel).toBe('Ask your lead');
  });

  it('writes the message for the lead with the install link and the team link', () => {
    const m = askDirectInstallMessage('acme/ds', 'https://github.com/apps/bridge-design-studio/installations/new', 'https://bridge.example.com/studio/acme/ds/');
    expect(m).toContain('github.com/acme/ds');
    expect(m).toContain('https://github.com/apps/bridge-design-studio/installations/new (pick ds)');
    expect(m).toContain('https://bridge.example.com/studio/acme/ds/');
    expect(m).not.toMatch(/\u2014/);
  });
});
