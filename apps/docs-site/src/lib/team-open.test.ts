// The shared opening of a team (lib/team-open.ts): the launcher and the "Create a new team" dialog say the same thing
// about what was typed, open the same address, and the dialog's live line names one of five cases per access state.
import { describe, expect, it } from 'vitest';
import type { RepoAccessState } from '@bridge-ds/core';
import { openTeamHref, readTeamField, TEAM_INPUT_ERRORS, teamCheck } from './team-open';

describe('readTeamField', () => {
  it('reads the repository from owner/repo, a GitHub address and an SSH remote', () => {
    expect(readTeamField('acme/ds')).toEqual({ ok: true, owner: 'acme', repo: 'ds' });
    expect(readTeamField('https://github.com/acme/ds/tree/main')).toEqual({ ok: true, owner: 'acme', repo: 'ds' });
    expect(readTeamField('git@github.com:acme/ds.git')).toEqual({ ok: true, owner: 'acme', repo: 'ds' });
  });

  it('says how to fix what is not a repository', () => {
    expect(readTeamField('')).toEqual({ ok: false, error: 'empty', message: TEAM_INPUT_ERRORS.empty });
    expect(readTeamField('acme')).toMatchObject({ ok: false, error: 'no-repo', message: TEAM_INPUT_ERRORS['no-repo'] });
    expect(readTeamField('https://gitlab.com/acme/ds')).toMatchObject({ ok: false, message: TEAM_INPUT_ERRORS['not-github'] });
  });

  it('writes every error without an em dash', () => {
    for (const m of Object.values(TEAM_INPUT_ERRORS)) expect(m).not.toContain('—');
  });
});

describe('openTeamHref', () => {
  it('opens the team address, and the escape form when the build takes the pair or the list is missing', async () => {
    expect(await openTeamHref('acme', 'ds', async () => ({ firsts: [], pairs: [] }))).toBe('/studio/acme/ds/');
    expect(await openTeamHref('brands', 'new', async () => ({ firsts: ['brands'], pairs: ['brands/new'] }))).toBe('/studio/~/brands/new/');
    expect(await openTeamHref('acme', 'ds', async () => null)).toBe('/studio/~/acme/ds/');
  });
});

describe('teamCheck (the live line)', () => {
  const kind = (state: RepoAccessState | null, signedIn = true, repoAdmin?: boolean) => teamCheck(state, { signedIn, repoAdmin })?.kind ?? null;

  it('maps the eight access states to the five cases', () => {
    expect(kind('admin')).toBe('ready');
    expect(kind('writer')).toBe('ready');
    expect(kind('reader')).toBe('ready');
    expect(kind('outside-contributor')).toBe('read-only');
    expect(kind('not-installed')).toBe('not-installed');
    expect(kind('no-access')).toBe('not-found');
    expect(kind('anonymous-public', false)).toBe('sign-in');
    expect(kind('anonymous-unknown', false)).toBe('sign-in');
  });

  it('offers Install Bridge to an admin of the repository only', () => {
    expect(teamCheck('not-installed', { signedIn: true, repoAdmin: true })?.install).toBe(true);
    expect(teamCheck('not-installed', { signedIn: true })?.install).toBeUndefined();
  });

  it('says nothing signed in when GitHub could not be asked, and asks to sign in when signed out', () => {
    expect(teamCheck(null, { signedIn: true })).toBeNull();
    expect(kind(null, false)).toBe('sign-in');
  });

  it('uses the briefed words, with no em dash', () => {
    const states: RepoAccessState[] = ['admin', 'outside-contributor', 'not-installed', 'no-access', 'anonymous-unknown'];
    expect(states.map((s) => teamCheck(s, { signedIn: true })?.label)).toEqual(['Ready', 'Read only', 'Bridge is not installed yet', 'Not found or private', 'Sign in to check']);
    for (const s of states) expect(JSON.stringify(teamCheck(s, { signedIn: true }))).not.toContain('—');
  });
});
