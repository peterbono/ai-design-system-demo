import { describe, expect, it } from 'vitest';
import { requesterLine, requesterOf } from '../src/index';

describe('requesterOf', () => {
  it('reads the line Bridge writes, in its three forms', () => {
    expect(requesterOf('## What changed\n\nRequested by Ann Leroy (@annleroy).\n\nMore text')).toEqual({ name: 'Ann Leroy', login: 'annleroy' });
    expect(requesterOf('Intro.\nRequested by Ann Leroy.')).toEqual({ name: 'Ann Leroy', login: null });
    expect(requesterOf('Requested by @ann-l.')).toEqual({ name: null, login: 'ann-l' });
  });

  it('reads the component change request footer', () => {
    expect(requesterOf('Body\n\n<sub>Requested from Figma by @dana with Bridge.</sub>')).toEqual({ name: null, login: 'dana' });
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
