// @vitest-environment jsdom
// People in plain-script rows: on the sample team (Acme Design) a login reads as its persona, never the repository's
// real account, and nothing is looked up on GitHub; on any other team, the profile name as before.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const s = vi.hoisted(() => ({ repo: { owner: 'peterbono', repo: 'bridge-demo-ds' }, site: { demo: { viewer: 'Dana' } } as Record<string, unknown>, ghGet: vi.fn() }));

vi.mock('./github-session', () => ({
  currentViewer: () => null,
  esc: (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
  ghGet: s.ghGet,
  hasWorkingToken: () => false,
}));
vi.mock('./repo-context', () => ({ repoContext: () => ({ ...s.repo, defaultBranch: 'main', hosted: true }), siteConfig: () => s.site }));
vi.mock('@bridge-ds/react/avatar-illustrated', () => ({ illustratedAvatarUri: (seed: string) => `data:image/svg+xml,${seed}` }));

const { displayName, lookUpNames, paintPeople, personHtml } = await import('./people');

const host = (html: string) => {
  const el = document.createElement('div');
  el.innerHTML = html;
  document.body.replaceChildren(el);
  return el;
};

beforeEach(() => {
  s.repo = { owner: 'peterbono', repo: 'bridge-demo-ds' };
  s.site = { demo: { viewer: 'Dana' } };
  s.ghGet.mockReset();
  s.ghGet.mockResolvedValue({ data: { name: 'Florian G' } });
});

describe('personHtml on the sample team', () => {
  it('reads Claude working from the real account as "Claude AI, with Dana"', async () => {
    const el = host(personHtml('peterbono', { agent: true, withName: false }));
    expect(el.textContent).toBe(', by Claude AI, with Dana');
    await paintPeople(el);
    expect(el.textContent).toBe(', by Claude AI, with Dana');
    expect(el.innerHTML).not.toMatch(/peterbono/);
  });

  it('reads the real account as the lead, with her face', () => {
    const el = host(personHtml('peterbono'));
    expect(el.querySelector('.person-name')?.textContent).toBe('Dana');
    expect(el.innerHTML).not.toMatch(/peterbono/);
    expect(el.querySelector('[data-face]')?.getAttribute('data-face')).toBe('~dana');
  });

  it('reads a sample member as that member, with the face Members shows', () => {
    const el = host(personHtml('~ann-leroy'));
    expect(el.querySelector('.person-name')?.textContent).toBe('Ann');
    expect(el.querySelector('[data-face]')?.getAttribute('data-face')).toBe('~ann-leroy');
  });

  it('keeps Claude as Claude AI', () => {
    expect(host(personHtml('claude[bot]')).querySelector('.person-name')?.textContent).toBe('Claude AI');
    expect(displayName('claude', true)).toBe('Claude AI');
  });

  it('repaints a mentioned login as the persona and never asks GitHub', async () => {
    const el = host('<span data-person="peterbono">@peterbono</span>');
    await paintPeople(el);
    expect(el.textContent).toBe('Dana');
    await lookUpNames(['peterbono', 'someone']);
    expect(s.ghGet).not.toHaveBeenCalled();
  });
});

describe('personHtml on another team', () => {
  it('keeps the login until the profile name is read', async () => {
    s.repo = { owner: 'acme', repo: 'ds' };
    const el = host(personHtml('octo-cat', { agent: true }));
    const name = () => el.querySelector('.person-name')?.textContent;
    expect(name()).toBe('Claude AI, with octo-cat');
    await paintPeople(el);
    expect(s.ghGet).toHaveBeenCalledWith('/users/octo-cat');
    expect(name()).toBe('Claude AI, with Florian G');
  });
});

describe('personHtml with a written name', () => {
  it('shows a name Bridge recorded ("Requested by Priya Shah") as written, never looked up nor lower-cased', async () => {
    s.repo = { owner: 'acme', repo: 'acme-flow' };
    const el = host(personHtml('Priya Shah'));
    const name = () => el.querySelector('.person-name')?.textContent;
    expect(name()).toBe('Priya Shah');
    expect(el.querySelector('[data-person]')).toBeNull();
    await paintPeople(el);
    expect(name()).toBe('Priya Shah');
    expect(s.ghGet).not.toHaveBeenCalledWith(expect.stringContaining('Priya'));
  });
});
