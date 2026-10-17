// Read local variables into a plain, serializable snapshot for the UI.

import {
  type FigmaResolvedType,
  type FigmaSnapshot,
  type FigmaValue,
  PLUGIN_DATA_KEYS,
  type SnapshotVariable,
  type VariablePluginData,
} from '../shared/messages';

const SUPPORTED: FigmaResolvedType[] = ['COLOR', 'FLOAT', 'STRING', 'BOOLEAN'];

export function readPluginData(v: PluginDataMixin): VariablePluginData {
  const pd: VariablePluginData = {};
  for (const key of PLUGIN_DATA_KEYS) {
    const raw = v.getPluginData(key);
    if (!raw) continue;
    if (key === 'orphan') pd.orphan = raw === 'true';
    else if (key === 'absentModes' || key === 'unlinkedModes') pd[key] = raw.split(',').filter(Boolean);
    else pd[key] = raw;
  }
  return pd;
}

export function writePluginData(v: PluginDataMixin, pd: VariablePluginData): void {
  for (const key of PLUGIN_DATA_KEYS) {
    if (!(key in pd)) continue;
    const value = pd[key];
    if (value === undefined || value === false || (Array.isArray(value) && value.length === 0)) v.setPluginData(key, '');
    else if (Array.isArray(value)) v.setPluginData(key, value.join(','));
    else v.setPluginData(key, String(value));
  }
}

const isAliasValue = (x: unknown): x is VariableAlias =>
  !!x && typeof x === 'object' && (x as { type?: unknown }).type === 'VARIABLE_ALIAS' && typeof (x as { id?: unknown }).id === 'string';

function toFigmaValue(raw: VariableValue): FigmaValue | undefined {
  if (isAliasValue(raw)) return { kind: 'alias', id: raw.id };
  if (typeof raw === 'number') return { kind: 'float', value: raw };
  if (typeof raw === 'string') return { kind: 'string', value: raw };
  if (typeof raw === 'boolean') return { kind: 'boolean', value: raw };
  if (raw && typeof raw === 'object') {
    if ('r' in raw && 'g' in raw && 'b' in raw) {
      const c = raw as RGBA | RGB;
      return { kind: 'color', r: c.r, g: c.g, b: c.b, a: 'a' in c ? c.a : 1 };
    }
    // Composed color (color + opacity); only the color part maps to DTCG.
    if ('color' in raw) {
      const color = (raw as { color: unknown }).color;
      if (isAliasValue(color)) return { kind: 'alias', id: color.id };
      if (color && typeof color === 'object' && 'r' in color) {
        const c = color as RGBA | RGB;
        return { kind: 'color', r: c.r, g: c.g, b: c.b, a: 'a' in c ? c.a : 1 };
      }
    }
  }
  return undefined;
}

export async function takeSnapshot(): Promise<FigmaSnapshot> {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const variables = await figma.variables.getLocalVariablesAsync();
  const localIds = new Set(variables.map((v) => v.id));
  const out: SnapshotVariable[] = [];
  const externalNames = new Map<string, string | undefined>();

  for (const v of variables) {
    if (!SUPPORTED.includes(v.resolvedType as FigmaResolvedType)) continue;
    const valuesByMode: Record<string, FigmaValue> = {};
    for (const [modeId, raw] of Object.entries(v.valuesByMode)) {
      const fv = toFigmaValue(raw);
      if (!fv) continue;
      if (fv.kind === 'alias' && !localIds.has(fv.id)) {
        if (!externalNames.has(fv.id)) {
          const target = await figma.variables.getVariableByIdAsync(fv.id).catch(() => null);
          externalNames.set(fv.id, target?.name);
        }
        fv.name = externalNames.get(fv.id);
      }
      valuesByMode[modeId] = fv;
    }
    out.push({
      id: v.id,
      name: v.name,
      collectionId: v.variableCollectionId,
      resolvedType: v.resolvedType as FigmaResolvedType,
      description: v.description ?? '',
      scopes: [...v.scopes],
      valuesByMode,
      pluginData: readPluginData(v),
    });
  }

  return {
    fileName: figma.root.name,
    collections: collections.map((c) => ({
      id: c.id,
      name: c.name,
      modes: c.modes.map((m) => ({ modeId: m.modeId, name: m.name })),
      defaultModeId: c.defaultModeId,
      remote: c.remote,
    })),
    variables: out,
  };
}
