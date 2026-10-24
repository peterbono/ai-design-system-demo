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
      // The variant's own frame, as the story shot is the component's own box: what overflows it (an open tooltip, a
      // focus ring) is not part of its size.
      const bytes = await child.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: scale }, useAbsoluteBounds: true });
      out[key] = figma.base64Encode(bytes);
    } catch {
      /* a variant Figma cannot export: reported as not compared */
    }
  }
  return out;
}

/** What a variant's layers read back for a gap case: each part's box (relative to the variant) and the parts not shown. */
export interface BuiltVariant {
  boxes: Record<string, { x: number; y: number; width: number; height: number }>;
  hidden: string[];
}

/**
 * Per variant key of a generated set, where each part sits and which parts are hidden: what lets a gap case say where
 * space is missing ("8 px missing below the label"). Read only.
 */
export async function readBuilt(nodeId: string, keys: string[]): Promise<Record<string, BuiltVariant>> {
  const set = await figma.getNodeByIdAsync(nodeId);
  const out: Record<string, BuiltVariant> = {};
  if (!set || set.type !== 'COMPONENT_SET') return out;
  const wanted = new Set(keys);
  for (const variant of set.children) {
    if (variant.type !== 'COMPONENT') continue;
    const key = variant.getSharedPluginData(NS, 'variant');
    if (!wanted.has(key)) continue;
    const origin = variant.absoluteTransform;
    const built: BuiltVariant = { boxes: {}, hidden: [] };
    const visit = (node: SceneNode, shown: boolean) => {
      const part = node === variant ? 'root' : node.getSharedPluginData(NS, 'part');
      const visible = shown && node.visible !== false;
      if (part) {
        if (!visible) built.hidden.push(part);
        else
          built.boxes[part] = {
            x: Math.round((node.absoluteTransform[0][2] - origin[0][2]) * 100) / 100,
            y: Math.round((node.absoluteTransform[1][2] - origin[1][2]) * 100) / 100,
            width: Math.round(node.width * 100) / 100,
            height: Math.round(node.height * 100) / 100,
          };
      }
      if ('children' in node && node.type !== 'INSTANCE') for (const c of node.children) visit(c, visible);
    };
    visit(variant, true);
    out[key] = built;
  }
  return out;
}
