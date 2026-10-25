import { describe, expect, it } from 'vitest';
import {
  accessContext,
  defaultSetting,
  domainList,
  emailDomainIn,
  libraryGate,
  maskEmail,
  MODE_WORDS,
  parseDomainField,
  PUBLIC_EMAIL_DOMAINS,
  SAMPLE_SETTING,
  settingLabel,
  signInToken,
  wrongDomainWords,
  type AccessAnswer,
} from './library-access';
import * as server from '../../api/library-access/index';

describe('the choice in words', () => {
  it('names each choice, the work email one with its domains', () => {
    expect(settingLabel({ mode: 'anyone', domains: [] })).toBe('Anyone with the link');
    expect(settingLabel({ mode: 'team', domains: [] })).toBe('Only the team');
    expect(settingLabel(SAMPLE_SETTING)).toBe('Anyone with a work email at acme.design');
    expect(settingLabel({ mode: 'email', domains: ['a.co', 'b.co', 'c.co'] })).toBe('Anyone with a work email at a.co, b.co and c.co');
    expect(domainList([])).toBe('');
  });

  it('defaults to what GitHub allows: anyone for a public repository, the team for a private one', () => {
    expect(defaultSetting(false)).toEqual({ mode: 'anyone', domains: [] });
    expect(defaultSetting(true)).toEqual({ mode: 'team', domains: [] });
  });

  it('has no em dash in any word a person reads', () => {
    expect(JSON.stringify(MODE_WORDS)).not.toContain('—');
  });
});

describe('domains typed in Settings', () => {
  it('takes several, with @ or capitals, once each', () => {
    expect(parseDomainField('@Acme.design, acme.studio acme.design')).toEqual({ domains: ['acme.design', 'acme.studio'] });
  });

  it('says what is wrong, in words', () => {
    expect(parseDomainField('')).toEqual({ error: 'Add your company email domain, like acme.design.' });
    expect(parseDomainField('acme')).toEqual({ error: 'acme is not an email domain. Write it like acme.design.' });
    expect(parseDomainField('https://acme.design')).toHaveProperty('error');
    expect(parseDomainField('Gmail.com')).toEqual({ error: 'Anyone can get an email at gmail.com. Pick your company domain, or choose Anyone with the link.' });
    expect(parseDomainField(Array.from({ length: 11 }, (_, i) => `d${i}.design`).join(','))).toEqual({ error: 'Add at most 10 domains.' });
  });

  it('refuses the same consumer providers as the server', () => {
    expect([...PUBLIC_EMAIL_DOMAINS]).toEqual([...server.PUBLIC_EMAIL_DOMAINS]);
  });

  it('matches an email on the exact part after the @, like the server', () => {
    const d = ['acme.design'];
    for (const e of ['mia@acme.design', 'Mia@ACME.Design', 'mia@eng.acme.design', 'mia@acme.design.evil.com', 'mia@acme.design@evil.com', 'acme.design@evil.com']) {
      expect(emailDomainIn(e, d), e).toBe(server.emailDomainIn(e, d));
    }
    expect(wrongDomainWords(['acme.design', 'acme.studio'])).toBe(server.wrongDomainWords(['acme.design', 'acme.studio']));
  });
});

describe('what a Library page shows', () => {
  const answer = (setting: AccessAnswer['setting'], session: AccessAnswer['session'] = null): AccessAnswer => ({ available: true, setting, session });

  it('opens as before for the sample team, a site without the feature, and a team that chose nothing', () => {
    const email = answer({ mode: 'email', domains: ['acme.design'], source: 'github' });
    expect(libraryGate({ sample: true, github: false, answer: email })).toBe('open');
    expect(libraryGate({ sample: false, github: false, answer: null })).toBe('open');
    expect(libraryGate({ sample: false, github: false, answer: { available: false, setting: null, session: null } })).toBe('open');
    expect(libraryGate({ sample: false, github: false, answer: answer(null) })).toBe('open');
  });

  it('asks for a work email until the reader has a session, then opens from GitHub or from this site', () => {
    expect(libraryGate({ sample: false, github: false, answer: answer({ mode: 'email', domains: ['acme.design'], source: 'github' }) })).toBe('email');
    expect(libraryGate({ sample: false, github: false, answer: answer({ mode: 'email', domains: ['acme.design'], source: 'github' }, { domain: 'acme.design' }) })).toBe('open');
    expect(libraryGate({ sample: false, github: false, answer: answer({ mode: 'email', domains: ['acme.design'], source: 'bridge' }, { domain: 'acme.design' }) })).toBe('open-bridge');
  });

  it('asks the team to sign in with GitHub, and lets a GitHub sign-in read as before', () => {
    expect(libraryGate({ sample: false, github: false, answer: answer({ mode: 'team', domains: [] }) })).toBe('team');
    expect(libraryGate({ sample: false, github: true, answer: answer({ mode: 'team', domains: [] }) })).toBe('open');
    expect(libraryGate({ sample: false, github: true, answer: answer({ mode: 'email', domains: ['acme.design'] }) })).toBe('open');
  });

  it('serves a private Library opened to anyone from this site', () => {
    expect(libraryGate({ sample: false, github: false, answer: answer({ mode: 'anyone', domains: [], source: 'bridge' }) })).toBe('open-bridge');
    expect(libraryGate({ sample: false, github: false, answer: answer({ mode: 'anyone', domains: [], source: 'github' }) })).toBe('open');
  });

  it('reads the link token from the address, nothing else', () => {
    const t = 'a'.repeat(43);
    expect(signInToken(`#signin=${t}`)).toBe(t);
    expect(signInToken(`#x=1&signin=${t}`)).toBe(t);
    expect(signInToken('#signin=short')).toBeNull();
    expect(signInToken(`#signin=${t}x`)).toBeNull();
    expect(signInToken('')).toBeNull();
  });

  it('masks the address on Check your inbox', () => {
    expect(maskEmail('Mia@Acme.design')).toBe('m•••@acme.design');
  });

  it('tells the sample team, a real team and no repository apart', () => {
    expect(accessContext('peterbono/bridge-demo-ds', false)).toBe('sample');
    expect(accessContext('peterbono/ai-design-system-demo', false)).toBe('real');
    expect(accessContext('acme/ds', true)).toBe('none');
  });
});
