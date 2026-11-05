// The team's Figma file (bridge.config.json `figma.file`): where the design system lives in Figma. People paste a
// link (https://www.figma.com/design/<key>/<name>?node-id=...) or the key alone; Bridge keeps what they gave and reads
// the key from it. A branch link names the branch's own key, as Figma's own tools read it. Pure and browser safe.

/** A Figma file key: letters and digits, as in figma.com/design/<key>/. */
const KEY = /^[A-Za-z0-9]{10,64}$/;

export interface FigmaFileRef {
  /** The file key (a branch's key for a branch link). */
  key: string;
  /** Where the file opens. */
  url: string;
}

/**
 * The file a link or a key names, null when it names none. Takes figma.com/design|file|proto|board/<key>/..., with
 * /branch/<branchKey>/ (the branch wins), with or without https:// and www.
 */
export function parseFigmaFile(input: unknown): FigmaFileRef | null {
  if (typeof input !== 'string') return null;
  const raw = input.trim();
  if (!raw) return null;
  if (KEY.test(raw)) return { key: raw, url: figmaFileUrl(raw) };
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (!/(^|\.)figma\.com$/i.test(url.hostname)) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  if (!['design', 'file', 'proto', 'board'].includes(parts[0] ?? '')) return null;
  const branchAt = parts.indexOf('branch');
  const key = branchAt > 0 ? parts[branchAt + 1] : parts[1];
  if (!key || !KEY.test(key)) return null;
  return { key, url: figmaFileUrl(key) };
}

/** Where a file opens, or one node of it ("12:34" or "12-34"). */
export function figmaFileUrl(key: string, node?: string | undefined): string {
  const base = `https://www.figma.com/design/${encodeURIComponent(key)}/`;
  return node ? `${base}?node-id=${encodeURIComponent(node.replace(/:/g, '-'))}` : base;
}

/** What is wrong with a typed Figma file, in one sentence a designer reads; null when Bridge can use it. */
export function figmaFileProblem(input: string): string | null {
  if (!input.trim()) return 'Paste the link of your Figma file.';
  return parseFigmaFile(input) ? null : 'Paste a link to a Figma file, for example https://www.figma.com/design/AbC123.../Library.';
}
