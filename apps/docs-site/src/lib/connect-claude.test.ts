import { describe, expect, it } from 'vitest';
import { CLAUDE_CONNECT_WORDS as W, connectClaudeStep, connectPath, identityLine, parseRequestInfo, readQuery, roleLabel, type RequestInfo } from './connect-claude';

const base: RequestInfo = { client: 'Claude', redirectHost: 'claude.ai', sameBrowser: true, signedIn: true, name: 'Dana', email: 'd***@acme.com', teams: [] };
const q = { request: 'abcdefghijklmnopqrstuvwx', error: null };

describe('Use Bridge in Claude: the steps', () => {
  it('reads only a request id it can trust, and the no-access answer', () => {
    expect(readQuery('?request=abcdefghijklmnopqrstuvwx')).toEqual(q);
    expect(readQuery('?request=<script>')).toEqual({ request: null, error: null });
    expect(readQuery('?error=no_access').error).toBe('no_access');
  });

  it('walks: no request, expired, another browser, signed out, no team, one team, several (sorted)', () => {
    expect(connectClaudeStep({ request: null, error: null }, null).kind).toBe('no-request');
    expect(connectClaudeStep({ request: null, error: 'no_access' }, null).kind).toBe('no-access');
    expect(connectClaudeStep(q, null).kind).toBe('expired');
    expect(connectClaudeStep(q, { ...base, sameBrowser: false }).kind).toBe('other-browser');
    expect(connectClaudeStep(q, { ...base, signedIn: false }).kind).toBe('signin');
    expect(connectClaudeStep(q, base).kind).toBe('no-teams');
    const one = connectClaudeStep(q, { ...base, teams: [{ repo: 'acme/design', name: 'Acme Design' }] });
    expect(one.kind === 'pick' && one.teams).toHaveLength(1);
    const several = connectClaudeStep(q, { ...base, teams: [{ repo: 'acme/web', name: 'Web' }, { repo: 'acme/design', name: 'Acme Design' }] });
    expect(several.kind === 'pick' && several.teams.map((t) => t.repo)).toEqual(['acme/design', 'acme/web']);
  });

  it('parses the server answer defensively', () => {
    expect(parseRequestInfo(null)).toBeNull();
    expect(parseRequestInfo({ client: 'Claude', redirectHost: 'claude.ai', teams: [{ repo: 'a/b' }, { nope: 1 }] })).toEqual({ client: 'Claude', redirectHost: 'claude.ai', sameBrowser: false, signedIn: false, name: null, email: null, teams: [{ repo: 'a/b', name: 'b' }] });
  });

  it('is true and never asks to come back by hand: what Claude gets, a person approves, no em dash', () => {
    expect([W.canRead, W.canPropose]).toEqual(['Read your design system', 'Open changes for review in your name']);
    expect(W.noTeams).toBe("Your Bridge account isn't in a team with a design system yet.");
    const all = Object.values(W).filter((v) => typeof v === 'string').join(' ');
    expect(all).not.toMatch(/come back here/i);
    expect(all).not.toMatch(/—/);
  });
});

describe('Use Bridge in Claude: with GitHub or with the Bridge sign-in', () => {
  it('keeps the email flag of a team, and only a true one', () => {
    const info = parseRequestInfo({ ...base, teams: [{ repo: 'acme/design', name: 'Design', email: true }, { repo: 'acme/other', name: 'Other', email: 'yes' }] })!;
    expect(info.teams).toEqual([{ repo: 'acme/design', name: 'Design', email: true }, { repo: 'acme/other', name: 'Other' }]);
  });

  it('a member by email with no GitHub sign-in here allows with Bridge alone; GitHub stays one link away', () => {
    const team = { repo: 'acme/design', name: 'Design', email: true };
    expect(connectPath(team, false)).toEqual({ path: 'email', other: 'github' });
    expect(connectPath(team, true)).toEqual({ path: 'github', other: 'email' });
    expect(connectPath({ repo: 'acme/design', name: 'Design' }, false)).toEqual({ path: 'github', other: null });
    expect(connectPath(undefined, false)).toEqual({ path: 'github', other: null });
    for (const words of [W.backEmail('claude.ai'), W.useEmail, W.useGitHub, W.allowingEmail]) expect(words).not.toContain('\u2014');
  });
});

describe('who Claude connects as', () => {
  it('keeps the role and the masked email the server sends', () => {
    const info = parseRequestInfo({ ...base, email: 'd***@yopmail.com', teams: [{ repo: 'acme/design', name: 'Design', email: true, role: 'edit' }] })!;
    expect(info.email).toBe('d***@yopmail.com');
    expect(info.teams[0]).toEqual({ repo: 'acme/design', name: 'Design', email: true, role: 'edit' });
  });

  it('says the role in Studio words', () => {
    expect(roleLabel('admin')).toBe('Admin');
    expect(roleLabel('edit')).toBe('Can edit');
    expect(roleLabel('Can edit')).toBe('Can edit');
    expect(roleLabel('review')).toBe('Reviewer');
    expect(roleLabel(null)).toBeNull();
  });

  it('names the person, their role and how they sign in, before Allow', () => {
    expect(identityLine({ name: 'Dino', role: 'edit', via: 'email' })).toBe("You're connecting Claude as Dino (Can edit, signed in with email).");
    expect(identityLine({ name: 'Florian', role: 'Admin', via: 'github' })).toBe("You're connecting Claude as Florian (Admin, signed in with GitHub).");
    expect(identityLine({ name: 'Ana', via: 'github' })).toBe("You're connecting Claude as Ana (signed in with GitHub).");
    for (const line of [identityLine({ name: 'Dino', role: 'edit', via: 'email' }), W.identityEmail('d***@yopmail.com'), W.identityGitHub('peterbono')]) expect(line).not.toContain('\u2014');
  });
});
