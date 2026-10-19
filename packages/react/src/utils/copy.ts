// Clipboard helper shared by CodeBlock and its DOM renderer (@bridge-ds/react/dom). No React.

/** Code split into runs of spaces and runs of other characters, in order: `npx a -b` -> npx, ' ', a, ' ', -b. */
export function splitRuns(code: string): string[] {
  return code.split(/(\s+)/).filter((r) => r !== '');
}

/** How long a copy button says "Copied", in ms. */
export const CODE_BLOCK_COPIED_MS = 2000;

/** Copies text, with the textarea fallback for pages without the async clipboard (http, older browsers). */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the fallback */
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}
