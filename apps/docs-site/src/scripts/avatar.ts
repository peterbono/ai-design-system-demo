// Statically rendered DS Avatar (Astro, no hydration) painted by a plain script once the viewer is known. Base UI
// renders the image only on the client, so the static markup holds the initials fallback alone; this adds the photo
// on top of it (.avatar-photo in site.css covers the circle) and writes the viewer's initial into the fallback.

// Initials like the DS Avatar's initials() (GitHub logins also split on - and _), local so the page script does not
// pull in the React bundle.
const initials = (name: string) => {
  const words = name.trim().split(/[\s_-]+/).filter(Boolean);
  if (words.length === 0) return '?';
  return (words[0]!.charAt(0) + (words.length > 1 ? words[words.length - 1]!.charAt(0) : '')).toUpperCase();
};

/** Shows `name` and its photo `url` (fetched at `px` device pixels) in the static DS Avatar `root`. */
export function paintAvatar(root: HTMLElement, name: string, url: string | undefined, px: number) {
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
