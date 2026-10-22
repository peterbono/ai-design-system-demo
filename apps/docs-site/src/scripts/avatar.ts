// Statically rendered DS Avatar (Astro, no hydration) painted by a plain script once the viewer is known. Base UI
// renders the image only on the client, so the static markup holds the initials fallback alone; this adds the photo
// on top of it (.avatar-photo in site.css covers the circle) and writes the viewer's initial into the fallback.

import { safeUrl } from '../lib/html';

// Initials like the DS Avatar's initials() (GitHub logins also split on - and _), local so the page script does not
// pull in the React bundle.
const initials = (name: string) => {
  const words = name.trim().split(/[\s_-]+/).filter(Boolean);
  if (words.length === 0) return '?';
  return (words[0]!.charAt(0) + (words.length > 1 ? words[words.length - 1]!.charAt(0) : '')).toUpperCase();
};

/** Shows `name` and its photo `url` (fetched at `px` device pixels) in the static DS Avatar `root`. */
export function paintAvatar(root: HTMLElement, name: string, rawUrl: string | undefined, px: number) {
  // The URL comes from the GitHub API or this browser's cache: http(s) or relative only, never javascript: or data:.
  const url = safeUrl(rawUrl);
  const fallback = root.querySelector(':scope > span[aria-hidden="true"]');
  if (fallback) fallback.textContent = initials(name);
  let img = root.querySelector<HTMLImageElement>('img.avatar-photo');
  if (!url) {
    img?.remove();
    return;
  }
  if (!img) {
    img = document.createElement('img');
    img.className = 'avatar-photo';
    img.alt = '';
    img.addEventListener('error', () => img?.remove());
    root.prepend(img);
  }
  const src = `${url}${url.includes('?') ? '&' : '?'}s=${px}`;
  if (img.getAttribute('src') !== src) img.src = src;
}

/**
 * Shows the DS default face for someone without a photo in the static DS Avatar `root`: the drawn face seeded by
 * `seed` (an email contributor's email), never initials. The drawings load once, after the first paint.
 */
export function paintDrawnAvatar(root: HTMLElement, seed: string) {
  const fallback = root.querySelector(':scope > span[aria-hidden="true"]');
  if (fallback) fallback.textContent = '';
  void import('@bridge-ds/react/avatar-illustrated').then(({ illustratedAvatarUri }) => {
    let img = root.querySelector<HTMLImageElement>('img.avatar-photo');
    if (!img) {
      img = document.createElement('img');
      img.className = 'avatar-photo';
      img.alt = '';
      root.prepend(img);
    }
    const src = illustratedAvatarUri(seed);
    if (img.getAttribute('src') !== src) img.src = src;
  });
}
