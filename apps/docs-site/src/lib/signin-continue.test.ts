import { describe, expect, it } from 'vitest';
import type { Account } from './account';
import { START_PAGE } from './start';
import { continueAs, readLastEmail, rememberEmail, sessionCta, LAST_EMAIL_KEY } from './signin-continue';

const acct = (over: Partial<Account> = {}): Account => ({ email: 'dinosolo@yopmail.com', name: 'Dino', github: null, teams: [], ...over });
const team = (repo: string, role = 'edit', name: string | null = null) => ({ repo, role, name, via: 'email' });

describe('signed in already: Continue as them', () => {
  it('nobody signed in: no Continue, the site keeps Sign in and Get started', () => {
    expect(continueAs({ account: null })).toBeNull();
    expect(sessionCta({ account: null })).toBeNull();
  });

  it('an email member continues to their team Studio, named with its role', () => {
    const c = continueAs({ account: acct({ teams: [team('peterbono/ai-design-system-demo', 'edit', 'Bridge DS')] }) });
    expect(c).toMatchObject({ name: 'Dino', detail: 'Bridge DS · Can edit', avatar: null, seed: '~dino' });
    expect(c!.href).toContain('peterbono/ai-design-system-demo/');
    expect(sessionCta({ account: acct({ teams: [team('peterbono/ai-design-system-demo')] }) })).toEqual({ label: 'Open Studio', href: c!.href });
  });

  it('several teams: the last one used on this browser', () => {
    const c = continueAs({ account: acct({ teams: [team('a/one'), team('b/two', 'admin', 'Two')] }), recent: ['B/two'] });
    expect(c!.detail).toBe('Two · Admin');
    expect(c!.href).toContain('b/two/');
  });

  it('an account without a team continues to the start page', () => {
    expect(continueAs({ account: acct() })).toMatchObject({ href: START_PAGE, detail: null });
  });

  it('GitHub: the photo, and the name when there is no other', () => {
    const c = continueAs({ account: acct({ name: null, github: { login: 'peterbono', id: 1 }, teams: [team('a/one', 'admin')] }) });
    expect(c!.name).toBe('dinosolo@yopmail.com');
    expect(c!.avatar).toContain('github.com/peterbono.png');
    expect(continueAs({ account: null, github: { login: 'peterbono' }, recent: ['a/one'] })).toMatchObject({ name: '@peterbono' });
    expect(continueAs({ account: null, github: { login: 'peterbono' } })!.href).toBe('/studio/');
    // A GitHub sign-in with a name, on a team this browser knows: the name, the team and the role, like the consent.
    expect(
      continueAs({ account: null, github: { login: 'peterbono', name: 'Florian' }, recent: ['peterbono/ai-design-system-demo'], teamNames: { 'peterbono/ai-design-system-demo': 'Bridge DS' }, teamRoles: { 'peterbono/ai-design-system-demo': 'Admin' } }),
    ).toMatchObject({ name: 'Florian', detail: 'Bridge DS · Admin' });
  });

  it('remembers the last email on this browser, never anything else', () => {
    const m = new Map<string, string>();
    const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    rememberEmail(store, 'not an email');
    expect(readLastEmail(store)).toBe('');
    rememberEmail(store, ' dinosolo@yopmail.com ');
    expect(m.get(LAST_EMAIL_KEY)).toBe('dinosolo@yopmail.com');
    expect(readLastEmail(store)).toBe('dinosolo@yopmail.com');
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(readLastEmail(broken)).toBe('');
    expect(() => rememberEmail(broken, 'a@b.co')).not.toThrow();
  });
});
