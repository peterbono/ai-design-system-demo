// @vitest-environment jsdom
// An archived exploration keeps its page: the preview and the activity, the Archived tag, one line and Unarchive. And
// the page leaves cleanly when the detail is written over before it unmounts (the blank page right after Archive).
import '../../../../../../packages/react/src/test/setup';
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExplorationPage, paintExplorationPage, unmountExplorationPage, type ExplorationPageProps } from './ExplorationPage';
import { ARCHIVED_LINE } from '../../../lib/explorations-view';
import { archivedHere } from '../../../scripts/exploration-page';

const florian = { login: 'florian', name: 'Florian', agent: false, avatar: null };

const base: ExplorationPageProps = {
  number: 3,
  crumbs: [{ label: 'Changes', href: '/studio/changes/' }, { label: 'Art print shop', href: '/studio/changes/' }, { label: 'Invoices header' }],
  title: 'Invoices header',
  stage: 'exploring',
  author: florian,
  startedTail: 'Art print shop · today',
  lines: { app: 'Open Bridge exploration admin-app#3', terminal: 'claude "Open Bridge exploration admin-app#3"' },
  todayUrl: 'https://shop.example.com',
  headline: null,
  previewUrl: 'https://shop-git-explore-invoices.example.com',
  previewNote: null,
  thumb: null,
  activity: [],
  done: { kind: 'run' },
  onDone: () => {},
  onArchive: null,
  onCopy: async () => {},
  developer: [],
  take: null,
  githubUrl: 'https://github.com/acme/shop-design/pull/3',
};

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('ExplorationPage, archived', () => {
  it('reads Archived with the line and Unarchive, keeps the preview, offers no Done exploring and no GitHub', async () => {
    const onUnarchive = vi.fn(async () => 'Back in the lists.');
    render(createElement(ExplorationPage, { ...base, archived: true, onUnarchive }));
    expect(screen.getByText('Archived')).toBeTruthy();
    expect(screen.getByText(ARCHIVED_LINE)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Open the preview/ }).getAttribute('href')).toBe(base.previewUrl);
    expect(screen.queryByRole('button', { name: 'Done exploring' })).toBeNull();
    expect(screen.queryByText(/github/i)).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Unarchive' }));
    });
    expect(onUnarchive).toHaveBeenCalledOnce();
  });

  it('offers nothing to keep working on: no Open in Claude Code, no Continue, no Bring it in; the preview fills the bar', () => {
    const latest = { line: 'Art print shop changed since this exploration started.', onBring: async () => 'In.' };
    const { container } = render(createElement(ExplorationPage, { ...base, archived: true, onUnarchive: async () => '', latest, claudeCodeUrl: 'https://claude.ai/code?x=1' }));
    expect(screen.queryByText('Open in Claude Code')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Bring it in' })).toBeNull();
    expect(screen.queryByText(/^Continue/)).toBeNull();
    expect(container.querySelector('.xp-preview-acts.is-one')!.children).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Unarchive' })).toBeTruthy();
  });

  it('archived before anything was built: no AI tool panel and no way to continue', () => {
    render(createElement(ExplorationPage, { ...base, stage: 'not-started', previewUrl: null, archived: true, onUnarchive: async () => '', claudeCodeUrl: 'https://claude.ai/code?x=1' }));
    expect(screen.getByText('Nothing built yet')).toBeTruthy();
    expect(screen.queryByText('Open in Claude Code')).toBeNull();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByText(/^Continue/)).toBeNull();
  });

  it('a running exploration of the copy still offers Open in Claude Code', () => {
    render(createElement(ExplorationPage, { ...base, claudeCodeUrl: 'https://claude.ai/code?x=1' }));
    expect(screen.getByText('Open in Claude Code')).toBeTruthy();
  });

  it('a viewer who cannot unarchive reads the line without the button', () => {
    render(createElement(ExplorationPage, { ...base, archived: true, onUnarchive: null }));
    expect(screen.getByText(ARCHIVED_LINE)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Unarchive' })).toBeNull();
  });

  it('opens on its page while archived, not once closed or shipped', () => {
    expect(archivedHere({ status: 'active', archived: true })).toBe(true);
    expect(archivedHere({ status: 'ready', archived: true })).toBe(true);
    expect(archivedHere({ status: 'shipped', archived: true })).toBe(false);
    expect(archivedHere({ status: 'closed', archived: true })).toBe(false);
    expect(archivedHere({ status: 'active', archived: false })).toBe(false);
  });
});

describe('leaving the page', () => {
  it('unmounting after the detail was written over does not throw', () => {
    const el = document.createElement('div');
    document.body.append(el);
    paintExplorationPage(el, base);
    el.innerHTML = '<p>Loading exploration #3</p>';
    expect(() => unmountExplorationPage()).not.toThrow();
    el.remove();
  });
});
