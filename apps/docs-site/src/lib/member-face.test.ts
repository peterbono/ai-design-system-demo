// One face per email member on every surface: the account menu, Members, the exploration cards and the activity of an
// exploration all draw the same seed (lib/people nameFace), whatever each surface knows about them.
import { describe, expect, it } from 'vitest';
import type { BranchCommitLike } from '@bridge-ds/core';
import { emailMemberFace, isEmailAddress, nameFace } from './people';
import { requesterPerson } from './home-model';
import { memberSeed } from './invites';
import { activityRows, faceOf, nameOnlyAuthors } from './exploration-page';

const saved = (name: string, email: string, at: string): BranchCommitLike =>
  ({ sha: at, author: null, commit: { message: 'Toast: shorter description', author: { name, email, date: at } } }) as unknown as BranchCommitLike;

describe('nameFace', () => {
  it('is ~ and the name as a slug, stable across case, accents and spacing', () => {
    expect(nameFace('Dino')).toBe('~dino');
    expect(nameFace('  dino ')).toBe('~dino');
    expect(nameFace('Priya Shah')).toBe('~priya-shah');
    expect(nameFace('Zoé Lefèvre')).toBe('~zoe-lefevre');
    expect(nameFace('***')).toBe('~someone');
  });

  it('names an email member by their name, else by the part before the @', () => {
    expect(emailMemberFace('Dino', 'dinosolo@yopmail.com')).toBe('~dino');
    expect(emailMemberFace(null, 'dinosolo@yopmail.com')).toBe('~dinosolo');
    expect(emailMemberFace('  ', 'dinosolo@yopmail.com')).toBe('~dinosolo');
  });

  it('tells an address from a login', () => {
    expect(isEmailAddress('dinosolo@yopmail.com')).toBe(true);
    expect(isEmailAddress('dino')).toBe(false);
    expect(isEmailAddress('@dino')).toBe(false);
  });
});

describe('every surface draws the same face for Dino', () => {
  const face = '~dino';

  it('the account menu and the header (signed in by email)', () => {
    expect(emailMemberFace('Dino', 'dinosolo@yopmail.com')).toBe(face);
  });

  it('Members, for Dino and for anyone else on the team (never a row index nor the email)', () => {
    expect(memberSeed({ login: 'dinosolo@yopmail.com', name: 'Dino', via: 'email' })).toBe(face);
    expect(memberSeed({ login: 'email-member-2', name: 'Dino', via: 'email' })).toBe(face);
    expect(memberSeed({ login: 'team-member-0', name: 'Dino', via: 'email' })).toBe(face);
    expect(memberSeed({ login: 'peterbono', name: 'Florian' })).toBe('peterbono');
  });

  it('the exploration cards ("Requested by Dino through Bridge.")', () => {
    expect(requesterPerson({ name: 'Dino', login: null })).toEqual({ login: face, name: 'Dino', avatar: null });
  });

  it('the activity of an exploration: a save through Bridge has no GitHub account, never a GitHub photo', () => {
    const commits = [saved('Dino', '002ceed60c2a@contributors.bridge.invalid', '2026-11-02T01:30:00Z')];
    expect([...nameOnlyAuthors(commits)]).toEqual(['Dino']);
    const rows = activityRows({ commits, author: 'dinosolo@yopmail.com', now: new Date('2026-11-02T01:40:00Z') });
    expect(rows[0]!.who).toMatchObject({ login: face, name: 'Dino', avatar: null, agent: false });
  });

  it('the author of an exploration recorded as an address', () => {
    expect(faceOf('dinosolo@yopmail.com', false, { 'dinosolo@yopmail.com': 'Dino' })).toEqual({ login: face, name: 'Dino', agent: false, avatar: null });
  });

  it('a GitHub login keeps its photo', () => {
    expect(faceOf('peterbono', false)).toMatchObject({ login: 'peterbono', avatar: 'https://github.com/peterbono.png?size=64' });
  });
});
