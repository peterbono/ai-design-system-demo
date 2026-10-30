// The one line a product mounts at its root: <BridgeToolbar ds="owner/design-system" product="checkout" />. It renders
// nothing and loads nothing unless Bridge Studio opened the page with `?bridge=<change>` (kept for the session), then
// loads the toolbar itself as one lazy chunk, with its styles.
import { lazy, Suspense, useState } from 'react';
import { readChanges, type BridgeBuild } from './session';
import type { ToolbarScope, ToolbarShop } from './scope';
import type { TogetherBase } from './together';

export interface BridgeToolbarProps {
  /** The design system repository, "owner/name". The toolbar reads its bridge.config.json when Studio opens the page. */
  ds?: string;
  /** This product's key in the design system's bridge.config.json products[] ("checkout"). */
  product?: string;
  /** Overrides of what the config says: production Studio, this product in production, its preview template. */
  studio?: string | null;
  production?: string | null;
  preview?: string | null;
  /** The deploy environment ("production", "preview"), when the host tells it at build time (VERCEL_ENV). */
  deployEnv?: string | null;
  /** Every fact at once, read at build time: no config read at run time (the Admin demo passes it). */
  build?: BridgeBuild;
  /** A hook that says where the page is and moves it (theme, shop). Default: the attributes ThemeProvider sets on <html>. */
  scope?: () => ToolbarScope;
  /** The shops of a multi-brand product, for the screens list and "Switch to <shop>". */
  shops?: ToolbarShop[];
  /** The latest library's token files as a combination base: lets Studio's "Try them together" run here. */
  together?: () => Promise<TogetherBase>;
}

const Toolbar = lazy(() => import('./Toolbar'));

function asked(): boolean {
  let store: Storage | null = null;
  try {
    store = window.sessionStorage;
  } catch {
    store = null;
  }
  return readChanges(window.location.search, store).length > 0;
}

/** Mounted once at the app root. Without a change from Studio it renders nothing and loads nothing. */
export function BridgeToolbar(props: BridgeToolbarProps) {
  const [on] = useState(() => typeof window !== 'undefined' && asked());
  if (!on) return null;
  return (
    <Suspense fallback={null}>
      <Toolbar {...props} />
    </Suspense>
  );
}
