// The toolbar and the outline layer are Bridge's tool, not the product: they must never take on a change's colours.
// Their tokens are pinned once, from the live Bridge tokens (production Studio's tokens.css), resolved in an isolated
// shadow root for the Bridge brand, the theme and compact density, and written as fixed values in one stylesheet that
// out-ranks both the page's tokens and the live swap. They are not read again after a swap.
import { useEffect } from 'react';

/** Marks an element (and what is inside it) as pinned: the toolbar root, the outline layer, their popups. */
export const PIN_ATTR = 'data-bridge-pin';
/** Same, as a class, for popups the DS portals out (Tooltip and Popover accept a className, not attributes). */
export const PIN_CLASS = 'bridge-pin';
const STYLE_ATTR = 'data-bridge-pinned';

const cssCache = new Map<string, Promise<string>>();
const valueCache = new Map<string, string>();

function liveCss(url: string): Promise<string> {
  if (!cssCache.has(url)) cssCache.set(url, fetch(url).then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status))))));
  return cssCache.get(url)!;
}

/** Every custom property the live tokens declare, resolved for the Bridge brand in one theme. */
function resolve(css: string, theme: string): string {
  const key = `${theme}|${css.length}`;
  const hit = valueCache.get(key);
  if (hit) return hit;
  const names = [...new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]!))];
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css.replace(/:root/g, ':host'));
  const host = document.createElement('div');
  host.style.display = 'none';
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.adoptedStyleSheets = [sheet];
  const scope = document.createElement('div');
  scope.setAttribute('data-theme', theme);
  scope.setAttribute('data-brand', 'bridge');
  scope.setAttribute('data-density', 'compact');
  shadow.appendChild(scope);
  const cs = getComputedStyle(scope);
  const decls = names
    .map((n) => [n, cs.getPropertyValue(n).trim()] as const)
    .filter(([, v]) => v !== '')
    .map(([n, v]) => `${n}: ${v};`)
    .join('\n  ');
  host.remove();
  valueCache.set(key, decls);
  return decls;
}

/** Writes the pinned tokens for the current theme. Three-fold selectors out-rank the tokens' attribute rules. */
export function usePinnedBridgeTokens(url: string | null, theme: string): void {
  useEffect(() => {
    if (!url) return;
    let live = true;
    liveCss(url)
      .then((css) => {
        if (!live) return;
        const decls = resolve(css, theme);
        let el = document.head.querySelector<HTMLStyleElement>(`style[${STYLE_ATTR}]`);
        if (!el) {
          el = document.createElement('style');
          el.setAttribute(STYLE_ATTR, '');
        }
        el.textContent = `[${PIN_ATTR}][${PIN_ATTR}][${PIN_ATTR}], .${PIN_CLASS}.${PIN_CLASS}.${PIN_CLASS} {\n  ${decls}\n}`;
        // Last in <head>, after the page's and the live tokens (whose link may be added later: it is re-appended then).
        document.head.appendChild(el);
      })
      .catch(() => {
        // Without the live tokens the toolbar keeps the page's: it still works, it may wear the change's colours.
      });
    return () => {
      live = false;
    };
  }, [url, theme]);
}
