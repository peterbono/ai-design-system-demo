// The return page after GitHub's access settings (pages/studio/auth/access.astro, the GitHub App's Setup URL with
// "Redirect on update"). Opened in the window "Give Bridge access" opened (components/ds/studio/AddProduct.tsx): it
// tells the dialog at once (this site only) and closes. Opened on its own: the page stays and says Bridge has access.
import { ACCESS_MESSAGE } from '../lib/add-product';

interface ReturnWindow {
  opener: { closed?: boolean; postMessage(message: unknown, targetOrigin: string): void } | null;
  location: { origin: string };
  close(): void;
}

/** True when it told the window that opened it (and closed itself); false when the page stays. */
export function returnToOpener(win: ReturnWindow): boolean {
  const opener = win.opener;
  if (!opener || opener.closed) return false;
  try {
    opener.postMessage({ type: ACCESS_MESSAGE }, win.location.origin);
  } catch {
    return false;
  }
  win.close();
  return true;
}
