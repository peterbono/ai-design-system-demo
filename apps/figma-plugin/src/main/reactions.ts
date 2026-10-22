/**
 * Prototype reactions in the shape setReactionsAsync accepts. Figma validates every key: one it does not know (such
 * as `deprecatedVersion` on a mouse enter or leave trigger, which the typings list but Figma rejects, or anything a
 * read of `node.reactions` returns beyond the documented shape) fails the whole call. So every reaction, ours or one
 * a designer added, is rebuilt from the documented keys only (@figma/plugin-typings Trigger, Action, Transition).
 */

type Dict = Record<string, unknown>;

const isDict = (v: unknown): v is Dict => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The keys of `src` named in `keys`, left out when undefined. */
function pick(src: Dict, keys: readonly string[]): Dict {
  const out: Dict = {};
  for (const k of keys) if (src[k] !== undefined) out[k] = src[k];
  return out;
}

const TRIGGER_KEYS: Record<string, readonly string[]> = {
  ON_CLICK: [],
  ON_HOVER: [],
  ON_PRESS: [],
  ON_DRAG: [],
  ON_MEDIA_END: [],
  AFTER_TIMEOUT: ['timeout'],
  MOUSE_UP: ['delay'],
  MOUSE_DOWN: ['delay'],
  MOUSE_ENTER: ['delay'],
  MOUSE_LEAVE: ['delay'],
  ON_KEY_DOWN: ['device', 'keyCodes'],
  ON_MEDIA_HIT: ['mediaHitTime'],
};

export function cleanTrigger(t: unknown): Trigger | null {
  if (!isDict(t) || typeof t.type !== 'string') return null;
  const keys = TRIGGER_KEYS[t.type];
  if (!keys) return { ...t } as unknown as Trigger;
  const out: Dict = { type: t.type, ...pick(t, keys) };
  if (Array.isArray(out.keyCodes)) out.keyCodes = [...(out.keyCodes as number[])];
  // A mouse trigger without a delay fires at once.
  if (['MOUSE_UP', 'MOUSE_DOWN', 'MOUSE_ENTER', 'MOUSE_LEAVE'].includes(t.type) && typeof out.delay !== 'number') out.delay = 0;
  return out as unknown as Trigger;
}

function cleanEasing(e: unknown): Easing {
  if (!isDict(e)) return { type: 'LINEAR' };
  const out: Dict = { type: e.type };
  if (isDict(e.easingFunctionCubicBezier)) out.easingFunctionCubicBezier = pick(e.easingFunctionCubicBezier, ['x1', 'y1', 'x2', 'y2']);
  if (isDict(e.easingFunctionSpring)) out.easingFunctionSpring = pick(e.easingFunctionSpring, ['mass', 'stiffness', 'damping', 'initialVelocity']);
  return out as unknown as Easing;
}

const DIRECTIONAL = new Set(['MOVE_IN', 'MOVE_OUT', 'PUSH', 'SLIDE_IN', 'SLIDE_OUT']);

function cleanTransition(t: unknown): Transition | null {
  if (!isDict(t)) return null;
  const out: Dict = { type: t.type, easing: cleanEasing(t.easing), duration: t.duration };
  if (DIRECTIONAL.has(t.type as string)) Object.assign(out, pick(t, ['direction', 'matchLayers']));
  return out as unknown as Transition;
}

const ACTION_KEYS: Record<string, readonly string[]> = {
  BACK: [],
  CLOSE: [],
  URL: ['url', 'openInNewTab'],
  UPDATE_MEDIA_RUNTIME: ['destinationId', 'mediaAction', 'amountToSkip', 'newTimestamp'],
  SET_VARIABLE: ['variableId', 'variableValue'],
  SET_VARIABLE_MODE: ['variableCollectionId', 'variableModeId'],
  NODE: ['destinationId', 'navigation', 'preserveScrollPosition', 'overlayRelativePosition', 'resetVideoPosition', 'resetScrollPosition', 'resetInteractiveComponents'],
};

export function cleanAction(a: unknown): Action | null {
  if (!isDict(a) || typeof a.type !== 'string') return null;
  if (a.type === 'CONDITIONAL') {
    const blocks = Array.isArray(a.conditionalBlocks) ? a.conditionalBlocks.filter(isDict) : [];
    return {
      type: 'CONDITIONAL',
      conditionalBlocks: blocks.map((b) => ({
        ...(b.condition !== undefined ? { condition: b.condition as VariableData } : {}),
        actions: (Array.isArray(b.actions) ? b.actions : []).map(cleanAction).filter((x): x is Action => x !== null),
      })),
    };
  }
  const keys = ACTION_KEYS[a.type];
  if (!keys) return { ...a } as unknown as Action;
  const out: Dict = { type: a.type, ...pick(a, keys) };
  if (a.type === 'NODE') {
    out.destinationId = a.destinationId ?? null;
    out.transition = cleanTransition(a.transition);
    if (isDict(out.overlayRelativePosition)) out.overlayRelativePosition = pick(out.overlayRelativePosition, ['x', 'y']);
  }
  return out as unknown as Action;
}

/**
 * A reaction with only the documented keys: `trigger` and `actions` (the deprecated single `action` Figma also
 * returns becomes the actions list when there is none). Null when it has no trigger Figma could read.
 */
export function cleanReaction(r: unknown): Reaction | null {
  if (!isDict(r)) return null;
  const trigger = cleanTrigger(r.trigger);
  if (!trigger) return null;
  const list = Array.isArray(r.actions) ? r.actions : r.action ? [r.action] : [];
  const actions = list.map(cleanAction).filter((x): x is Action => x !== null);
  return { trigger, actions };
}

export function cleanReactions(list: readonly unknown[]): Reaction[] {
  return list.map(cleanReaction).filter((x): x is Reaction => x !== null);
}
