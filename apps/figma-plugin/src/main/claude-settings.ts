// Main thread: the optional Anthropic API key and model for "Draft with Claude". Like the GitHub token, the key lives in
// figma.clientStorage (this computer, this plugin): never in the file's plugin data, never shown again in the UI.
// The UI gets it in memory to call api.anthropic.com directly; nothing else receives it.

import { DEFAULT_CLAUDE_MODEL, type ClaudeModel, isClaudeModel } from '../sync/claude';

export const CLAUDE_KEY = 'anthropic-api-key';
export const CLAUDE_MODEL_KEY = 'anthropic-model';

export interface ClaudeSettings {
  hasKey: boolean;
  /** Sent to the UI so it can call the Messages API. The UI keeps it in memory and never renders it. */
  key: string | undefined;
  model: ClaudeModel;
}

export async function readClaudeSettings(): Promise<ClaudeSettings> {
  const key = (await figma.clientStorage.getAsync(CLAUDE_KEY)) as string | undefined;
  const model = (await figma.clientStorage.getAsync(CLAUDE_MODEL_KEY)) as string | undefined;
  return { hasKey: !!key, key: key || undefined, model: isClaudeModel(model) ? model : DEFAULT_CLAUDE_MODEL };
}

/** Saves the model, and the key when one is given (an empty key keeps the saved one). */
export async function saveClaudeSettings(input: { key?: string | undefined; model?: string | undefined }): Promise<{ hasKey: boolean; model: ClaudeModel }> {
  const key = input.key?.trim();
  if (key) {
    if (!/^sk-ant-[A-Za-z0-9_-]{10,}$/.test(key)) throw new Error('That does not look like an Anthropic API key. Keys start with sk-ant-. Copy it again from console.anthropic.com.');
    await figma.clientStorage.setAsync(CLAUDE_KEY, key);
  }
  if (input.model !== undefined) {
    if (!isClaudeModel(input.model)) throw new Error('Pick one of the listed Claude models.');
    await figma.clientStorage.setAsync(CLAUDE_MODEL_KEY, input.model);
  }
  const s = await readClaudeSettings();
  return { hasKey: s.hasKey, model: s.model };
}

export async function clearClaudeKey(): Promise<{ cleared: true }> {
  await figma.clientStorage.deleteAsync(CLAUDE_KEY);
  return { cleared: true };
}
