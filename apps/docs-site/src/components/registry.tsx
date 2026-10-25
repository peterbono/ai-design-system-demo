// One registry of renderable components, shared by the static examples (Example.tsx) and the props playground.
// Every export of @bridge-ds/react that is a component is registered automatically, so a new component shows up in
// the docs as soon as it is exported. A few layout helpers used only by the docs examples are added by hand.
import type { ComponentType, CSSProperties, ReactNode } from 'react';
import * as DS from '@bridge-ds/react';
import { Copy, Ellipsis, GitPullRequest, Pencil, Trash2, type LucideIcon } from 'lucide-react';
import { safeUrl } from '../lib/html';

const layout = (style: CSSProperties) =>
  function Layout({ children }: { children?: ReactNode }) {
    return <div style={style}>{children}</div>;
  };

const isComponent = (name: string, v: unknown) =>
  /^[A-Z]/.test(name) && (typeof v === 'function' || (typeof v === 'object' && v !== null && '$$typeof' in v));

export const REGISTRY: Record<string, ComponentType<any>> = {
  ...(Object.fromEntries(Object.entries(DS).filter(([k, v]) => isComponent(k, v))) as Record<string, ComponentType<any>>),
  Row: layout({ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)', alignItems: 'center' }),
  Box: layout({ maxWidth: '26rem', width: '100%' }),
};

/** Icons used by the docs examples, by Lucide name. Kept explicit so the client playground stays small;
 * the static renderer (Example.tsx) falls back to the full Lucide set. */
export const COMMON_ICONS: Record<string, LucideIcon> = { Copy, Ellipsis, MoreHorizontal: Ellipsis, GitPullRequest, Pencil, Trash2 };

/** Props that take a Lucide icon component instead of a string. */
export const ICON_PROPS = new Set(['icon', 'leadingIcon', 'trailingIcon', 'startIcon', 'endIcon']);

/** Props that hold a URL: run through safeUrl (no javascript: or data:). */
const URL_PROPS = new Set(['href', 'src', 'action', 'formAction', 'poster', 'xlinkHref', 'cite', 'data']);

/**
 * Example props come from <Name>.docs.json in the repository (any branch, any repo in the hosted Studio), and DS
 * components spread unknown props onto DOM elements. So, at every depth: no dangerouslySetInnerHTML, no srcDoc, no
 * on* handler (JSON has no functions anyway), and URL props limited to http, https, mailto or relative.
 */
function safeProp(key: string, value: unknown): unknown {
  if (key === 'dangerouslySetInnerHTML' || key === 'srcDoc' || /^on[A-Z]/.test(key)) return undefined;
  if (URL_PROPS.has(key) && typeof value === 'string') return safeUrl(value, '#');
  if (Array.isArray(value)) return value.map((v) => safeProp('', v));
  if (typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const s = safeProp(k, v);
      if (s !== undefined) out[k] = s;
    }
    return out;
  }
  return value;
}

export function resolveProps(props: Record<string, unknown> = {}, lookup: (name: string) => unknown = (n) => COMMON_ICONS[n]) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    const s = ICON_PROPS.has(k) && typeof v === 'string' ? lookup(v) : safeProp(k, v);
    if (s !== undefined) out[k] = s;
  }
  return out;
}
