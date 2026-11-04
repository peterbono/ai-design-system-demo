import { describe, expect, it } from 'vitest';
import { emailMemberTeam, emailStudioLink, emailStudioRedirect, memberStudioRedirect, teamStudioRoute } from './email-studio';

const reserved = { firsts: [], pairs: [] };
const base = { github: false, teamPage: false, emailTeams: ['the-bridge-company/ai-design-system-demo'], recent: [], reserved: null };

describe('email member Studio', () => {
  it('picks the page team, else the most recent, else the first', () => {
    expect(emailMemberTeam(['a/one', 'b/two'], ['b/two'], 'A/ONE')).toEqual({ owner: 'a', repo: 'one' });
    expect(emailMemberTeam(['a/one', 'b/two'], ['c/x', 'B/two'])).toEqual({ owner: 'b', repo: 'two' });
    expect(emailMemberTeam(['a/one', 'b/two'])).toEqual({ owner: 'a', repo: 'one' });
    expect(emailMemberTeam([])).toBeNull();
  });

  it('knows which Studio pages a team address has', () => {
    expect(teamStudioRoute('/studio/')).toBe('');
    expect(teamStudioRoute('/studio')).toBe('');
    expect(teamStudioRoute('/studio/changes/')).toBe('changes/');
    expect(teamStudioRoute('/studio/products/admin-app/')).toBe('products/admin-app/');
    for (const p of ['/studio/auth/', '/studio/invite/', '/studio/connect-claude/', '/studio/workspace/', '/studio/the-bridge-company/ai-design-system-demo/', '/components/button/'])
      expect(teamStudioRoute(p)).toBeNull();
  });

  it('sends an email member from /studio to the same page of their team', () => {
    expect(emailStudioRedirect({ ...base, pathname: '/studio/' })).toBe('/studio/~/the-bridge-company/ai-design-system-demo/');
    expect(emailStudioRedirect({ ...base, pathname: '/studio/tokens/', search: '?focus=color', hash: '#x', reserved })).toBe(
      '/studio/the-bridge-company/ai-design-system-demo/tokens/?focus=color#x',
    );
  });

  it('leaves GitHub users, team addresses, shared pages and people with no email team alone', () => {
    expect(emailStudioRedirect({ ...base, pathname: '/studio/', github: true })).toBeNull();
    expect(emailStudioRedirect({ ...base, pathname: '/studio/', teamPage: true })).toBeNull();
    expect(emailStudioRedirect({ ...base, pathname: '/studio/invite/' })).toBeNull();
    expect(emailStudioRedirect({ ...base, pathname: '/studio/', emailTeams: [] })).toBeNull();
  });

  it('points a build-time Studio link at the team, keeping its query', () => {
    const team = { owner: 'the-bridge-company', repo: 'ai-design-system-demo' };
    expect(emailStudioLink('/studio/', team, reserved)).toBe('/studio/the-bridge-company/ai-design-system-demo/');
    expect(emailStudioLink('/studio', team, reserved)).toBe('/studio/the-bridge-company/ai-design-system-demo/');
    expect(emailStudioLink('/studio/components/?c=button', team, reserved)).toBe('/studio/the-bridge-company/ai-design-system-demo/components/?c=button');
    expect(emailStudioLink('/studio/auth/', team, reserved)).toBeNull();
  });
});

describe('the hosted showcase for its own team', () => {
  const entry = { pathname: '/studio/', hostedSite: true, teamPage: false, pageRepo: 'the-bridge-company/ai-design-system-demo', member: true, reserved };

  it('sends a member of the shown team to the same page of its team address', () => {
    expect(memberStudioRedirect(entry)).toBe('/studio/the-bridge-company/ai-design-system-demo/');
    expect(memberStudioRedirect({ ...entry, pathname: '/studio/settings/', search: '?x=1', hash: '#team' })).toBe('/studio/the-bridge-company/ai-design-system-demo/settings/?x=1#team');
  });

  it('leaves visitors, self-hosted Studios, team addresses and shared pages alone', () => {
    expect(memberStudioRedirect({ ...entry, member: false })).toBeNull();
    expect(memberStudioRedirect({ ...entry, hostedSite: false })).toBeNull();
    expect(memberStudioRedirect({ ...entry, teamPage: true })).toBeNull();
    expect(memberStudioRedirect({ ...entry, pathname: '/studio/invite/' })).toBeNull();
    expect(memberStudioRedirect({ ...entry, pageRepo: null })).toBeNull();
  });
});
