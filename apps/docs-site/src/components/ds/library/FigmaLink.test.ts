// @vitest-environment jsdom
// The "In Figma" line of a component: the link for everyone once the component map has it; "Not linked to Figma yet"
// with the next step for a lead or an admin only, nothing for anyone else. Bridge's own Library reads the role from the
// maintainer check (it never starts the Studio's GitHub session, which left an admin without the line); a team's
// Library and Studio from the team's read (teamLead). No technical words, no em dash.
import '../../../../../../packages/react/src/test/setup';
import { act, cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FigmaLink, figmaLinkFor } from './FigmaLink';
import { FIGMA_FILE_WORDS } from '../../../lib/figma-file';

let token: string | null = 'gho_aaaaaaaaaaaaADMIN1';
vi.mock('../../../scripts/github-session', () => ({
  API: 'https://api.github.com',
  getToken: () => token,
  markTokenRejected: vi.fn(),
  readRepo: () => ({ owner: 'the-bridge-company', repo: 'ai-design-system-demo' }),
  tokenRejected: () => false,
}));
vi.mock('../../../scripts/avatar', () => ({ paintAvatar: vi.fn() }));
let member: { role: string } | null = null;
vi.mock('../../../scripts/contribute-session', () => ({ contributorFor: () => member, contributeBlobs: vi.fn() }));

const LINK = { name: 'Button', url: 'https://www.figma.com/design/AbCdEf/DS?node-id=12-34' };
const base = { settingsHref: '/studio/settings/#tools' };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const flush = () => act(() => new Promise((r) => setTimeout(r, 0)));
const line = () => document.querySelector('.cp-figma');

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  document.documentElement.removeAttribute('data-maintainer');
  member = null;
});

describe('the Figma line', () => {
  it('links a mapped component for everyone', () => {
    render(createElement(FigmaLink, { ...base, link: LINK, fileSet: true, canFix: false }));
    expect(line()?.textContent).toContain(`${FIGMA_FILE_WORDS.inFigma}Button`);
    expect(screen.getByRole('link', { name: /Button/ }).getAttribute('href')).toBe(LINK.url);
  });

  it('says nothing to a reader who cannot link it', () => {
    render(createElement(FigmaLink, { ...base, link: null, fileSet: false, canFix: false }));
    expect(line()).toBeNull();
  });

  it('gives a lead the next step: the Figma file in Settings first, then Claude', () => {
    const { rerender } = render(createElement(FigmaLink, { ...base, link: null, fileSet: false, canFix: true }));
    expect(line()?.textContent).toContain(FIGMA_FILE_WORDS.notLinked);
    expect(screen.getByRole('link', { name: FIGMA_FILE_WORDS.setFileFirst }).getAttribute('href')).toBe(base.settingsHref);
    rerender(createElement(FigmaLink, { ...base, link: null, fileSet: true, canFix: true }));
    expect(line()?.textContent).toContain(FIGMA_FILE_WORDS.howToLink);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('reads what the model says', () => {
    const model = { config: {}, componentMap: null } as unknown as Parameters<typeof figmaLinkFor>[0];
    expect(figmaLinkFor(model, 'Button')).toEqual({ link: null, fileSet: false });
  });

  it('uses plain words, without em dash or file names', () => {
    for (const w of Object.values(FIGMA_FILE_WORDS)) {
      expect(w).not.toMatch(/\u2014|JSON|bridge\.(config|components)|\bkey\b/i);
    }
  });
});

describe("the Figma line on Bridge's own Library", () => {
  beforeEach(() => vi.resetModules());

  it('shows the next step to a signed-in admin, from the check painted at load', async () => {
    document.documentElement.setAttribute('data-maintainer', '');
    const { default: FigmaLinkSite } = await import('../../FigmaLinkSite');
    render(createElement(FigmaLinkSite, { ...base, link: null, fileSet: false }));
    expect(line()?.textContent).toContain(FIGMA_FILE_WORDS.notLinked);
  });

  it('shows it once the token check says the account writes to the repository', async () => {
    token = 'gho_aaaaaaaaaaaaADMIN1';
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).endsWith('/user') ? json(200, { login: 'peterbono', avatar_url: '' }) : json(200, { permissions: { admin: true, push: true } }))));
    const [{ default: FigmaLinkSite }, { initMaintainer }] = await Promise.all([import('../../FigmaLinkSite'), import('../../../scripts/maintainer')]);
    render(createElement(FigmaLinkSite, { ...base, link: null, fileSet: false }));
    expect(line()).toBeNull();
    initMaintainer();
    await flush();
    await flush();
    expect(line()?.textContent).toContain(FIGMA_FILE_WORDS.notLinked);
  });

  it('stays quiet for a reader who only reads the repository', async () => {
    token = 'gho_aaaaaaaaaaaaREADER';
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).endsWith('/user') ? json(200, { login: 'ann', avatar_url: '' }) : json(200, { permissions: { pull: true } }))));
    const [{ default: FigmaLinkSite }, { initMaintainer }] = await Promise.all([import('../../FigmaLinkSite'), import('../../../scripts/maintainer')]);
    render(createElement(FigmaLinkSite, { ...base, link: null, fileSet: false }));
    initMaintainer();
    await flush();
    await flush();
    expect(line()).toBeNull();
  });
});

describe('a lead of a team (Library and Studio Components)', () => {
  it('is a GitHub account that writes, or an email admin; never an email member who edits', async () => {
    const { teamLead } = await import('../../../scripts/team-data');
    const team = { owner: 'acme', repo: 'ds' };
    expect(teamLead({ ...team, canEdit: false })).toBe(false);
    expect(teamLead({ ...team, canEdit: true })).toBe(true);
    member = { role: 'admin' };
    expect(teamLead({ ...team, canEdit: true })).toBe(true);
    member = { role: 'edit' };
    expect(teamLead({ ...team, canEdit: true })).toBe(false);
  });
});
