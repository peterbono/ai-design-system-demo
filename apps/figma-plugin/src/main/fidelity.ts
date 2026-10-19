// Fidelity check, main thread: exports generated variants as PNG for the UI to compare with the code images.
// Read only: nothing in the file changes.

const NS = 'dsbridge';

/**
 * PNG (base64) of each requested variant of a generated set, at `scale`, keyed by variant key. Variants that are
 * missing or cannot be exported are left out.
 */
export async function exportVariants(nodeId: string, keys: string[], scale: number): Promise<Record<string, string>> {
  const set = await figma.getNodeByIdAsync(nodeId);
  const out: Record<string, string> = {};
  if (!set || set.type !== 'COMPONENT_SET') return out;
  const wanted = new Set(keys);
  for (const child of set.children) {
    if (child.type !== 'COMPONENT') continue;
    const key = child.getSharedPluginData(NS, 'variant');
    if (!wanted.has(key)) continue;
    try {
      const bytes = await child.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: scale } });
      out[key] = figma.base64Encode(bytes);
    } catch {
      /* a variant Figma cannot export: reported as not compared */
    }
  }
  return out;
}
