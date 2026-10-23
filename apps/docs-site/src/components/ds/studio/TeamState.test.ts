// @vitest-environment jsdom
// The line under a team page's title ("Read at a1b2c3d on main, live from GitHub."): for a viewer signed in with
// GitHub only. Email members and guests (designers) never read commit SHAs.
import '../../../../../../packages/react/src/test/setup';
import { createElement } from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TeamData } from '../../../scripts/team-data';

const session = vi.hoisted(() => ({ github: false }));
vi.mock('../../../scripts/github-session', () => ({ signedInWithGitHub: () => session.github }));

const { TeamSourceNote } = await import('./TeamState');

const data = { owner: 'acme', repo: 'acme-product', sha: 'a1b2c3d4e5f6', defaultBranch: 'main', source: 'live' } as unknown as TeamData;

describe('TeamSourceNote', () => {
  afterEach(() => {
    session.github = false;
  });

  it('says nothing to an email member or a guest', () => {
    const { container } = render(createElement(TeamSourceNote, { data, refreshing: false, onRefresh: () => undefined }));
    expect(container).toBeEmptyDOMElement();
  });

  it('gives a GitHub viewer the commit it was read at, linked', () => {
    session.github = true;
    render(createElement(TeamSourceNote, { data, refreshing: false, onRefresh: () => undefined }));
    expect(screen.getByRole('link', { name: 'a1b2c3d' })).toHaveAttribute('href', expect.stringContaining('a1b2c3d4e5f6'));
    expect(screen.getByText(/live from GitHub/)).toBeInTheDocument();
  });

  it('follows a sign-in on the page', () => {
    const { container } = render(createElement(TeamSourceNote, { data, refreshing: false, onRefresh: () => undefined }));
    expect(container).toBeEmptyDOMElement();
    session.github = true;
    document.dispatchEvent(new CustomEvent('bridge:auth', { detail: { signedIn: true } }));
    return vi.waitFor(() => expect(screen.getByRole('link', { name: 'a1b2c3d' })).toBeInTheDocument());
  });
});
