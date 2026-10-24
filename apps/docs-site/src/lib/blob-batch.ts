// Blob reads gathered into batches, page-wide. Every caller that wants a file's text by its blob sha asks here; the
// shas asked in the same moment (one timer tick) go out as one request (/api/contribute?blobs=, api/_lib/team-read.ts),
// and a sha already read is never asked again on this page (a blob never changes). The home's token cards and the
// status reads of the same changes ask for the same blobs: one batch serves them all. Pure: the request and the timer
// are passed in. Unit tested in blob-batch.test.ts.

/** The text of each sha asked, null for one GitHub does not have; a sha left out of the answer is read alone. */
export type BlobBatch = (shas: string[]) => Promise<Record<string, string | null>>;

/** The text of a blob: a string, null when GitHub has none, undefined when the batch left it out or failed. */
export type BlobRead = (sha: string) => Promise<string | null | undefined>;

export const SHA40 = /^[0-9a-f]{40}$/;

/** Shas per request (the server takes at most 100, api/_lib/team-read.ts MAX_BATCH). */
export const BLOB_BATCH_SIZE = 80;

export interface BlobBatcherOptions {
  /** Shas per request. */
  size?: number;
  /** Runs `flush` once the current moment is over (a timer tick by default). */
  schedule?: (flush: () => void) => void;
}

/**
 * A reader that batches: every sha asked before the scheduled flush goes out in the same request (split by `size`),
 * each sha once. A sha that came back (text or null) is kept; one left out, or a refused batch, answers undefined and
 * is asked again next time.
 */
export function blobBatcher(batch: BlobBatch, opts: BlobBatcherOptions = {}): BlobRead {
  const size = opts.size ?? BLOB_BATCH_SIZE;
  const schedule = opts.schedule ?? ((f) => void setTimeout(f, 0));
  const kept = new Map<string, Promise<string | null | undefined>>();
  let wanted = new Map<string, (t: string | null | undefined) => void>();
  const flush = async () => {
    const now = wanted;
    wanted = new Map();
    const shas = [...now.keys()];
    await Promise.all(
      Array.from({ length: Math.ceil(shas.length / size) }, async (_, i) => {
        const part = shas.slice(i * size, (i + 1) * size);
        const got: Record<string, string | null> = await batch(part).catch(() => ({}));
        for (const s of part) {
          const text = Object.prototype.hasOwnProperty.call(got, s) && (typeof got[s] === 'string' || got[s] === null) ? got[s] : undefined;
          if (text === undefined) kept.delete(s);
          now.get(s)!(text);
        }
      }),
    );
  };
  return (sha) => {
    const had = kept.get(sha);
    if (had) return had;
    if (!SHA40.test(sha)) return Promise.resolve(undefined);
    if (!wanted.size) schedule(() => void flush());
    const p = new Promise<string | null | undefined>((resolve) => wanted.set(sha, resolve));
    kept.set(sha, p);
    return p;
  };
}

/** One changed file of a pull request, as GitHub lists it (GET pulls/{n}/files). */
export interface ChangedFile {
  filename: string;
  status?: string;
  /** The blob at the head commit (absent or null for a removed file). */
  sha?: string | null;
  previous_filename?: string;
}

/** GitHub lists at most this many files per page: a list this long may be cut, so it cannot stand for the head tree. */
export const FILES_PAGE = 100;

/**
 * The files of a change's head commit (path to blob sha) from its base commit's files and the files it changes, so the
 * head's tree is not read: the base's, with each removed or renamed file dropped and each added or changed file at its
 * new blob. null when the list cannot tell (a full page, or a file without its blob sha): read the head's tree then.
 */
export function headFilesOf(base: ReadonlyMap<string, string>, changed: readonly ChangedFile[]): Map<string, string> | null {
  if (changed.length >= FILES_PAGE) return null;
  const out = new Map(base);
  for (const f of changed) {
    if (f.previous_filename && f.previous_filename !== f.filename) out.delete(f.previous_filename);
    if (f.status === 'removed') {
      out.delete(f.filename);
      continue;
    }
    if (typeof f.sha !== 'string' || !SHA40.test(f.sha)) return null;
    out.set(f.filename, f.sha);
  }
  return out;
}
