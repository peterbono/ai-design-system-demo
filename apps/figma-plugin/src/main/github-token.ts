// Main thread: the GitHub token and what GitHub last said about it, both in figma.clientStorage (this computer, this
// plugin), never in the file. "rejected" means GitHub answered 401 to the last call with it: it was revoked,
// regenerated or has expired. Saving a new token, or removing it, clears that state.

import type { TokenState } from '../shared/messages';

export const TOKEN_KEY = 'github-token';
export const TOKEN_STATE_KEY = 'github-token-state';

export async function readGitHubToken(): Promise<{ token: string | undefined; tokenState: TokenState | undefined }> {
  const token = (await figma.clientStorage.getAsync(TOKEN_KEY)) as string | undefined;
  if (!token) return { token: undefined, tokenState: undefined };
  const stored = (await figma.clientStorage.getAsync(TOKEN_STATE_KEY)) as string | undefined;
  return { token, tokenState: stored === 'rejected' ? 'rejected' : 'ok' };
}

/** A new token starts clean: whatever GitHub said about the previous one no longer applies. */
export async function saveGitHubToken(token: string): Promise<{ saved: true }> {
  await figma.clientStorage.setAsync(TOKEN_KEY, token.trim());
  await figma.clientStorage.deleteAsync(TOKEN_STATE_KEY);
  return { saved: true };
}

export async function clearGitHubToken(): Promise<{ cleared: true }> {
  await figma.clientStorage.deleteAsync(TOKEN_KEY);
  await figma.clientStorage.deleteAsync(TOKEN_STATE_KEY);
  return { cleared: true };
}

/** Records what the last call with the saved token showed. Nothing to record without a token. */
export async function setGitHubTokenState(state: TokenState): Promise<{ tokenState: TokenState | undefined }> {
  const token = (await figma.clientStorage.getAsync(TOKEN_KEY)) as string | undefined;
  if (!token) return { tokenState: undefined };
  if (state === 'rejected') await figma.clientStorage.setAsync(TOKEN_STATE_KEY, 'rejected');
  else await figma.clientStorage.deleteAsync(TOKEN_STATE_KEY);
  return { tokenState: state };
}
