import { describe, expect, it } from 'vitest';
import { DEV_MESSAGE_WORDS, developersMessage, offersDevelopersMessage, teamMember } from './developers-message';

const base = {
  name: 'Bigger frame picker',
  product: 'Poster Studio',
  address: 'https://posterstudio.com',
  startPage: 'https://posterstudio.com/frames',
  purpose: 'Frames are hard to compare on a phone: show them as large swatches.',
  previewUrl: 'https://design-git-explore-frames.vercel.app',
  shotUrl: 'https://raw.githubusercontent.com/acme/ds/bridge-shots/acme/poster-design/4.webp',
};

describe('developersMessage', () => {
  it('says what changes, the page today, the preview and the screenshot, in plain words', () => {
    expect(developersMessage(base)).toBe(
      [
        'A change to Poster Studio is ready to build: Bigger frame picker.',
        '',
        'What changes: Frames are hard to compare on a phone: show them as large swatches.',
        'The page today: https://posterstudio.com/frames',
        'The preview: https://design-git-explore-frames.vercel.app',
        'A screenshot: https://raw.githubusercontent.com/acme/ds/bridge-shots/acme/poster-design/4.webp',
        '',
        'Open the preview next to the page today to see the change. It rebuilds the page with our design system, so take it as the picture of what to build in Poster Studio, not as code to copy.',
        '',
        'Ask me if anything is unclear.',
      ].join('\n'),
    );
  });

  it('stays self-contained without a start page, a purpose, a preview or a screenshot', () => {
    const m = developersMessage({ name: 'Bigger frame picker', product: 'Poster Studio', address: 'https://posterstudio.com' });
    expect(m).toContain('A change to Poster Studio is ready to build.\n\nWhat changes: Bigger frame picker');
    expect(m).toContain('The page today: https://posterstudio.com');
    expect(m).not.toMatch(/The preview:|A screenshot:/);
    expect(m).toContain('The preview link follows as soon as it is ready.');
  });

  it('never carries tech words, em dashes or a link that is not https', () => {
    const m = developersMessage({ ...base, purpose: 'Bigger swatches \u2014 easier\non phones', previewUrl: 'javascript:alert(1)', shotUrl: 'http://example.com/a.png' });
    expect(m).not.toMatch(/[\u2014\u2013]/);
    expect(m).toContain('What changes: Bigger swatches, easier on phones');
    expect(m).not.toContain('javascript:');
    expect(m).not.toContain('http://example.com');
    expect(developersMessage({ ...base, shotUrl: null })).not.toMatch(/github|branch|pull request|repositor|commit|\bmerge|\bissue\b|Bridge/i);
  });
});

describe('who sees "Copy for your developers"', () => {
  it('team members only: email members and people who can read the team on GitHub, never signed-out or sample visitors', () => {
    expect(teamMember({ emailMember: true, signedIn: false, access: null })).toBe(true);
    expect(teamMember({ emailMember: false, signedIn: true, access: 'reader' })).toBe(true);
    expect(teamMember({ emailMember: false, signedIn: true, access: 'writer' })).toBe(true);
    expect(teamMember({ emailMember: false, signedIn: true, access: 'admin' })).toBe(true);
    expect(teamMember({ emailMember: false, signedIn: false, access: 'anonymous-public' })).toBe(false);
    expect(teamMember({ emailMember: false, signedIn: true, access: 'no-access' })).toBe(false);
    expect(teamMember({ emailMember: false, signedIn: true, access: 'outside-contributor' })).toBe(false);
    expect(teamMember({ emailMember: false, signedIn: true, access: null })).toBe(false);
    expect(teamMember({ emailMember: true, signedIn: true, access: 'admin', sample: true })).toBe(false);
  });

  it('an address product, once done exploring and until it ships, declined or archived aside', () => {
    const at = (x: Partial<Parameters<typeof offersDevelopersMessage>[0]>) => offersDevelopersMessage({ address: base.address, status: 'ready', member: true, ...x });
    expect(at({})).toBe(true);
    expect(at({ status: 'building' })).toBe(true);
    // Being built's words for the same stages.
    expect(at({ status: 'requested' })).toBe(true);
    expect(at({ status: 'in-progress' })).toBe(true);
    expect(at({ status: 'active' })).toBe(false);
    expect(at({ status: 'shipped' })).toBe(false);
    expect(at({ status: 'in-review' })).toBe(false);
    expect(at({ declined: true })).toBe(false);
    expect(at({ archived: true })).toBe(false);
    expect(at({ member: false })).toBe(false);
    expect(at({ address: null })).toBe(false);
  });

  it('speaks in the Bridge voice', () => {
    for (const w of Object.values(DEV_MESSAGE_WORDS)) expect(w).not.toMatch(/[\u2014\u2013]/);
    expect(DEV_MESSAGE_WORDS.said).toBe('Message copied. Paste it where your developers work.');
    expect(DEV_MESSAGE_WORDS.elsewhere).toBe('Their developers work elsewhere: send them the message.');
  });
});
