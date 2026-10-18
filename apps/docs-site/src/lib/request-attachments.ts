// What a component change request can carry besides words: the Figma frame link and one image (pasted or picked),
// committed to the requests branch like the Figma plugin does (@bridge-ds/core REQUESTS_BRANCH, requestImagePath).
// Pure, tested in request-attachments.test.ts.
import { REQUESTS_BRANCH } from '@bridge-ds/core';

/** Largest image a request accepts. GitHub's contents API takes more, but a frame export never needs it. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

/** The problem with a Figma link, as a sentence that says how to fix it, or null when it is empty or valid. */
export function figmaLinkProblem(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return 'Paste the whole Figma link: in Figma, right-click the frame, then Copy link to selection.';
  }
  if (u.protocol !== 'https:' || !/(^|\.)figma\.com$/.test(u.hostname)) return 'This is not a Figma link. In Figma, right-click the frame, then Copy link to selection.';
  return null;
}

/** The request's `figma` field from a link: the URL, plus the file key and node id when the link names them. */
export function figmaFromLink(raw: string): { url: string; fileKey?: string; nodeId?: string } | undefined {
  const v = raw.trim();
  if (!v || figmaLinkProblem(v)) return undefined;
  const u = new URL(v);
  const key = /^\/(?:design|file|proto|board)\/([A-Za-z0-9]+)/.exec(u.pathname)?.[1];
  const node = u.searchParams.get('node-id')?.replace(/-/g, ':');
  return { url: v, ...(key ? { fileKey: key } : {}), ...(node ? { nodeId: node } : {}) };
}

/** The problem with an attached image, or null when it can be sent. */
export function imageProblem(file: { type: string; size: number }): string | null {
  if (!IMAGE_TYPES.includes(file.type)) return 'Attach a PNG, JPEG, GIF or WebP image, for example a frame exported from Figma.';
  if (file.size > MAX_IMAGE_BYTES) return 'This image is larger than 5 MB. Export the frame at 1x or crop it, then attach it again.';
  return null;
}

/** Public URL of a file on the requests branch, as GitHub serves it to an issue body (same as the Figma plugin). */
export const requestImageUrl = (owner: string, repo: string, path: string) => `https://github.com/${owner}/${repo}/blob/${REQUESTS_BRANCH}/${path}?raw=true`;

/** Base64 content of a data URL ("data:image/png;base64,AAAA" -> "AAAA"), or null when it is not base64. */
export function base64Of(dataUrl: string): string | null {
  const m = /^data:[^;,]+;base64,(.+)$/.exec(dataUrl);
  return m ? m[1]! : null;
}
