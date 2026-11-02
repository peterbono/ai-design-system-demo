import { describe, expect, it } from 'vitest';
import { authorFor, isAppLogin, isNameAuthor, nameAuthor, nameOfAuthor } from './author';

const block = (o: Record<string, unknown>) => `Requested by Dino through Bridge.\n\n<!-- bridge-exploration ${JSON.stringify(o)} -->`;

describe('authorFor', () => {
  it('keeps a person', () => {
    expect(authorFor('peterbono', 'anything')).toBe('peterbono');
    expect(authorFor(null, null)).toBeNull();
  });
  it('shows the email member an app opened it for, by name, never the app', () => {
    const body = block({ name: 'add a toast alert', member: '254dfac3665d4d07', memberName: 'Dino' });
    expect(authorFor('bridge-design-studio[bot]', body)).toBe('name:Dino');
    expect(authorFor('app/bridge-design-studio', body)).toBe('name:Dino');
    expect(authorFor('bridge-design-studio[bot]', 'Requested by Priya Shah through Bridge.')).toBe('name:Priya Shah');
  });
  it('shows a designer by their GitHub login when the body names one', () => {
    expect(authorFor('bridge-design-studio[bot]', 'Requested by Ann Leroy (@ann) through Bridge.')).toBe('ann');
  });
  it('leaves automation that opened it for nobody as the app', () => {
    expect(authorFor('renovate[bot]', 'Bumps deps.')).toBe('renovate[bot]');
  });
  it('marks name-only authors', () => {
    expect(isNameAuthor(nameAuthor('Dino'))).toBe(true);
    expect(isNameAuthor('dino')).toBe(false);
    expect(isNameAuthor('~ann-leroy')).toBe(false);
    expect(nameOfAuthor('name:Dino')).toBe('Dino');
    expect(isAppLogin('app/x')).toBe(true);
    expect(isAppLogin('x[bot]')).toBe(true);
    expect(isAppLogin('peterbono')).toBe(false);
  });
});

describe('the exploration page reads the person, never the app', () => {
  it('draws the name face for a name author and for a name-only commit author', async () => {
    const { faceOf } = await import('./exploration-page');
    const { nameFace } = await import('./people');
    const started = faceOf('name:Dino', false);
    expect(started).toEqual({ login: nameFace('Dino'), name: 'Dino', agent: false, avatar: null });
    // Done exploring by a commit with no GitHub account ("Dino"): the same face, so no "started by" tail either.
    const done = faceOf('Dino', false, {}, false, new Set(['Dino']));
    expect(done.login).toBe(started.login);
    expect(done.avatar).toBeNull();
  });
});
