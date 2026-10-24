import { describe, expect, it } from 'vitest';
import { requesterLine, requesterOf } from '../src/index';

describe('requesterOf', () => {
  it('reads the line Bridge writes, in its three forms', () => {
    expect(requesterOf('## What changed\n\nRequested by Ann Leroy (@annleroy).\n\nMore text')).toEqual({ name: 'Ann Leroy', login: 'annleroy' });
    expect(requesterOf('Intro.\nRequested by Ann Leroy.')).toEqual({ name: 'Ann Leroy', login: null });
    expect(requesterOf('Requested by @ann-l.')).toEqual({ name: null, login: 'ann-l' });
  });

  it('reads the line Bridge\'s server writes for an email member, without the email', () => {
    expect(requesterOf('Tokens\n\nRequested by Priya Shah (priya@acme.com) through Bridge.')).toEqual({ name: 'Priya Shah', login: null });
    expect(requesterOf('Requested by Priya Shah through Bridge.')).toEqual({ name: 'Priya Shah', login: null });
  });

  it('reads the component change request footer', () => {
    expect(requesterOf('Body\n\n<sub>Requested from Figma by @dana with Bridge.</sub>')).toEqual({ name: null, login: 'dana' });
  });

  it('reads a suggestion footer when no Requested by line is there', () => {
    expect(requesterOf('Body\n\n<sub>Suggested from Figma by @dana with Bridge.</sub>')).toEqual({ name: null, login: 'dana' });
    expect(requesterOf('Requested by Leo Martin.\n\n<sub>Suggested from Bridge by @peterbono with Bridge.</sub>')).toEqual({ name: 'Leo Martin', login: null });
    expect(requesterOf('## Suggested change: Softer borders')).toBeNull();
  });

  it('ignores prose and malformed lines', () => {
    expect(requesterOf(null)).toBeNull();
    expect(requesterOf('This was requested by the marketing team in March.')).toBeNull();
    expect(requesterOf('Requested by Ann Leroy (@not a login).')).toBeNull();
    expect(requesterOf('Requested by https://example.com/x?y=1.')).toBeNull();
  });

  it('writes what it reads', () => {
    for (const r of [
      { name: 'Léo Martin', login: 'leom' },
      { name: 'Dana', login: null },
      { name: null, login: 'ann' },
    ]) {
      expect(requesterOf(`Text\n\n${requesterLine(r)}\n`)).toEqual(r);
    }
    expect(() => requesterLine({ name: null, login: null })).toThrow();
  });
});
