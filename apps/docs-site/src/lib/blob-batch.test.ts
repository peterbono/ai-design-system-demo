import { describe, expect, it } from 'vitest';
import { blobBatcher, FILES_PAGE, headFilesOf, type BlobBatch } from './blob-batch';

const sha = (n: number) => n.toString(16).padStart(40, '0');

/** A batch that answers every sha with its text, counting the requests. */
function server(texts: Record<string, string | null>, leaveOut: string[] = []) {
  const calls: string[][] = [];
  const batch: BlobBatch = async (shas) => {
    calls.push(shas);
    return Object.fromEntries(shas.filter((s) => !leaveOut.includes(s)).map((s) => [s, texts[s] ?? null]));
  };
  return { calls, batch };
}

/** A scheduler the test flushes by hand: what the page asks in one moment. */
function manual() {
  let queued: (() => void)[] = [];
  return {
    schedule: (f: () => void) => void queued.push(f),
    run: async () => {
      const now = queued;
      queued = [];
      now.forEach((f) => f());
      await new Promise((r) => setTimeout(r, 0));
    },
  };
}

describe('blobBatcher', () => {
  it('asks the blobs of one moment in one request, each sha once (five cards, seven blobs: one read)', async () => {
    const { calls, batch } = server({ [sha(1)]: 'a', [sha(2)]: 'b', [sha(3)]: 'c' });
    const tick = manual();
    const read = blobBatcher(batch, { schedule: tick.schedule });
    const asked = [read(sha(1)), read(sha(2)), read(sha(1)), read(sha(3)), read(sha(2))];
    await tick.run();
    expect(await Promise.all(asked)).toEqual(['a', 'b', 'a', 'c', 'b']);
    expect(calls).toEqual([[sha(1), sha(2), sha(3)]]);
  });

  it('never asks again for a blob it read, and asks the new ones of a later moment together', async () => {
    const { calls, batch } = server({ [sha(1)]: 'a', [sha(2)]: 'b' });
    const tick = manual();
    const read = blobBatcher(batch, { schedule: tick.schedule });
    const first = read(sha(1));
    await tick.run();
    await first;
    const again = [read(sha(1)), read(sha(2))];
    await tick.run();
    expect(await Promise.all(again)).toEqual(['a', 'b']);
    expect(calls).toEqual([[sha(1)], [sha(2)]]);
  });

  it('splits a long list by the batch size', async () => {
    const { calls, batch } = server({});
    const tick = manual();
    const read = blobBatcher(batch, { schedule: tick.schedule, size: 2 });
    const asked = [1, 2, 3, 4, 5].map((n) => read(sha(n)));
    await tick.run();
    await Promise.all(asked);
    expect(calls.map((c) => c.length)).toEqual([2, 2, 1]);
  });

  it('answers undefined for a blob left out or a refused batch, and asks it again next time', async () => {
    const { calls, batch } = server({ [sha(1)]: 'a', [sha(2)]: 'b' }, [sha(2)]);
    const tick = manual();
    const read = blobBatcher(batch, { schedule: tick.schedule });
    const asked = [read(sha(1)), read(sha(2))];
    await tick.run();
    expect(await Promise.all(asked)).toEqual(['a', undefined]);
    const again = read(sha(2));
    await tick.run();
    await again;
    expect(calls).toEqual([[sha(1), sha(2)], [sha(2)]]);

    const refused = blobBatcher(() => Promise.reject(new Error('busy')), { schedule: tick.schedule });
    const r = refused(sha(1));
    await tick.run();
    expect(await r).toBeUndefined();
  });

  it('keeps null (GitHub has no such blob) and never sends an odd sha', async () => {
    const { calls, batch } = server({});
    const tick = manual();
    const read = blobBatcher(batch, { schedule: tick.schedule });
    const gone = read(sha(9));
    const odd = read('main');
    await tick.run();
    expect(await gone).toBeNull();
    expect(await odd).toBeUndefined();
    expect(calls).toEqual([[sha(9)]]);
  });
});

describe('headFilesOf', () => {
  const base = new Map([
    ['bridge.config.json', sha(1)],
    ['tokens/light.tokens.json', sha(2)],
    ['tokens/old.tokens.json', sha(3)],
    ['tokens/gone.tokens.json', sha(4)],
  ]);

  it('is the base files with the change applied: modified, added, renamed and removed', () => {
    const head = headFilesOf(base, [
      { filename: 'tokens/light.tokens.json', status: 'modified', sha: sha(12) },
      { filename: 'tokens/new.tokens.json', status: 'added', sha: sha(13) },
      { filename: 'tokens/renamed.tokens.json', status: 'renamed', sha: sha(3), previous_filename: 'tokens/old.tokens.json' },
      { filename: 'tokens/gone.tokens.json', status: 'removed', sha: null },
    ]);
    expect(head && Object.fromEntries(head)).toEqual({
      'bridge.config.json': sha(1),
      'tokens/light.tokens.json': sha(12),
      'tokens/new.tokens.json': sha(13),
      'tokens/renamed.tokens.json': sha(3),
    });
    // The base is left as it was.
    expect(base.get('tokens/light.tokens.json')).toBe(sha(2));
  });

  it('cannot tell from a full page of files or a file without its blob: null (read the head tree)', () => {
    const full = Array.from({ length: FILES_PAGE }, (_, i) => ({ filename: `f${i}`, status: 'modified', sha: sha(i + 100) }));
    expect(headFilesOf(base, full)).toBeNull();
    expect(headFilesOf(base, [{ filename: 'tokens/light.tokens.json', status: 'modified' }])).toBeNull();
  });
});
