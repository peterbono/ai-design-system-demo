// An in-memory stand-in for the parts of the Figma Plugin API that the main thread uses to write variables
// (src/main/apply.ts), build component sets (src/main/build-components.ts) and read component signatures
// (src/main/components.ts). Installed as the global `figma` for a test. It models what those files rely on (nodes,
// shared plugin data, variable bindings, component properties, variants, fonts that must be loaded before text is
// set), not Figma's renderer: exportAsync returns a hash-friendly description of the node tree with bound values
// resolved, so a render hash moves when a bound value moves.
//
// Icons and slots: createNodeFromSvg (one VECTOR per SVG shape in a 24x24 frame), flatten, instances (children are
// copies of the main component's, swapComponent keeps the overrides of same-named layers, as Figma does when names
// match) and INSTANCE_SWAP properties (default must be a component id, preferred values kept).

type Dict = Record<string, unknown>;

let seq = 0;
const nextId = (prefix: string) => `${prefix}:${++seq}`;

interface Alias {
  type: 'VARIABLE_ALIAS';
  id: string;
}

export class SimCollection {
  id = nextId('VariableCollectionId');
  remote = false;
  modes: { modeId: string; name: string }[];
  defaultModeId: string;
  removed = false;
  constructor(
    public name: string,
    private api: SimFigma,
  ) {
    this.defaultModeId = nextId('mode');
    this.modes = [{ modeId: this.defaultModeId, name: 'Mode 1' }];
  }
  renameMode(modeId: string, name: string) {
    const m = this.modes.find((x) => x.modeId === modeId);
    if (m) m.name = name;
  }
  addMode(name: string) {
    if (this.api.modeLimit && this.modes.length >= this.api.modeLimit) throw new Error('Limited to 1 modes only');
    const id = nextId('mode');
    this.modes.push({ modeId: id, name });
    return id;
  }
  remove() {
    this.removed = true;
    this.api.collections = this.api.collections.filter((c) => c !== this);
  }
}

export class SimVariable {
  id = nextId('VariableID');
  description = '';
  scopes: string[] = ['ALL_SCOPES'];
  valuesByMode: Record<string, unknown> = {};
  private pd = new Map<string, string>();
  remote = false;
  constructor(
    public name: string,
    public variableCollectionId: string,
    public resolvedType: string,
    private api: SimFigma,
  ) {}
  setValueForMode(modeId: string, value: unknown) {
    this.valuesByMode[modeId] = value && typeof value === 'object' && 'r' in (value as Dict) ? { ...(value as Dict) } : value;
  }
  getPluginData(k: string) {
    return this.pd.get(k) ?? '';
  }
  private shared = new Map<string, string>();
  getSharedPluginData(ns: string, k: string) {
    return this.shared.get(`${ns}|${k}`) ?? '';
  }
  setSharedPluginData(ns: string, k: string, v: string) {
    if (v === '') this.shared.delete(`${ns}|${k}`);
    else this.shared.set(`${ns}|${k}`, v);
  }
  setPluginData(k: string, v: string) {
    this.pd.set(k, v);
  }
  /** Resolved in each collection's default mode (the sim has no explicit modes on nodes). */
  resolveForConsumer(_node: unknown): { value: unknown; resolvedType: string } {
    return { value: this.api.resolveVariable(this), resolvedType: this.resolvedType };
  }
}

const CONTAINERS = new Set(['DOCUMENT', 'PAGE', 'FRAME', 'COMPONENT', 'COMPONENT_SET']);
/** VariableBindableNodeField (plus text fields), as @figma/plugin-typings lists them. */
const FRAME_BINDABLE = new Set([
  'height', 'width', 'characters', 'itemSpacing', 'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom', 'visible', 'topLeftRadius', 'topRightRadius',
  'bottomLeftRadius', 'bottomRightRadius', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight', 'counterAxisSpacing', 'strokeWeight', 'strokeTopWeight',
  'strokeRightWeight', 'strokeBottomWeight', 'strokeLeftWeight', 'opacity', 'gridRowGap', 'gridColumnGap',
]);
const TEXT_BINDABLE = new Set([...FRAME_BINDABLE, 'fontFamily', 'fontSize', 'fontStyle', 'fontWeight', 'letterSpacing', 'lineHeight', 'paragraphSpacing', 'paragraphIndent']);
/** Fields a copy never shares with its source. */
const OWN = new Set(['id', 'parent', 'children', 'api', 'mainId']);

export class SimNode {
  id: string;
  name = '';
  parent: SimNode | null = null;
  children: SimNode[] = [];
  x = 0;
  y = 0;
  // Like Figma: read only, changed with resize().
  private size = { width: 100, height: 40 };
  get width(): number {
    return this.size.width;
  }
  get height(): number {
    return this.size.height;
  }
  description = '';
  fills: Dict[] = [];
  strokes: Dict[] = [];
  remote = false;
  componentPropertyReferences: Record<string, string> | null = null;
  private shared = new Map<string, string>();
  private bound = new Map<string, Alias>();
  private props = new Map<string, { type: string; defaultValue: string | boolean; preferredValues?: { type: string; key: string }[] }>();
  /** INSTANCE: id of its main component. */
  mainId = '';
  private _characters = '';
  private _fontName: { family: string; style: string } = { family: 'Inter', style: 'Regular' };
  [key: string]: unknown;

  constructor(
    public type: string,
    private api: SimFigma,
  ) {
    if (api.nodeLimit && api.nodes.size >= api.nodeLimit) throw new Error('Out of memory: this file has too many layers');
    this.id = nextId(type === 'PAGE' ? '0' : '1');
    api.nodes.set(this.id, this);
    if (type === 'TEXT') {
      this.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
      this._text.textAutoResize = 'WIDTH_AND_HEIGHT';
    }
    // Figma frames and components clip their content by default.
    if (type === 'FRAME' || type === 'COMPONENT') this.clipsContent = true;
  }

  // Auto layout sizing, modelled on Figma: layoutSizingHorizontal / Vertical are shorthands over the node's own axis
  // sizing (primaryAxisSizingMode / counterAxisSizingMode) and how it sits in its auto layout parent (layoutAlign on the
  // parent's cross axis, layoutGrow on its main axis). Hugging an axis drops a fill on it, as in Figma.
  layoutAlign = 'INHERIT';
  layoutGrow = 0;
  /** How a layer follows its parent's resizing (absolute layers: pinned edges, stretched, centered). */
  constraints: { horizontal: string; vertical: string } = { horizontal: 'MIN', vertical: 'MIN' };
  private axisSizing = { primary: 'FIXED', counter: 'FIXED' };
  private autoLayout(n: SimNode | null): boolean {
    return !!n && (n.layoutMode === 'HORIZONTAL' || n.layoutMode === 'VERTICAL');
  }
  /** Which own sizing field holds an axis ("primary" or "counter"), for an auto layout node. */
  private axisOf(horizontal: boolean): 'primary' | 'counter' {
    return (this.layoutMode === 'HORIZONTAL') === horizontal ? 'primary' : 'counter';
  }
  private fills_(horizontal: boolean): boolean {
    const p = this.parent;
    if (!p || !this.autoLayout(p)) return false;
    const parentHorizontal = p.layoutMode === 'HORIZONTAL';
    return parentHorizontal === horizontal ? this.layoutGrow === 1 : this.layoutAlign === 'STRETCH';
  }
  private clearFill(horizontal: boolean): void {
    const p = this.parent;
    if (!p || !this.autoLayout(p)) return;
    if ((p.layoutMode === 'HORIZONTAL') === horizontal) this.layoutGrow = 0;
    else this.layoutAlign = 'INHERIT';
  }
  get primaryAxisSizingMode() {
    return this.axisSizing.primary;
  }
  set primaryAxisSizingMode(v: string) {
    this.axisSizing.primary = v;
    if (v === 'AUTO' && this.autoLayout(this)) this.clearFill(this.layoutMode === 'HORIZONTAL');
  }
  get counterAxisSizingMode() {
    return this.axisSizing.counter;
  }
  set counterAxisSizingMode(v: string) {
    this.axisSizing.counter = v;
    if (v === 'AUTO' && this.autoLayout(this)) this.clearFill(this.layoutMode !== 'HORIZONTAL');
  }
  private sizing(horizontal: boolean): string {
    if (this.fills_(horizontal)) return 'FILL';
    if (this.type === 'TEXT') return this.textAutoResize === 'WIDTH_AND_HEIGHT' || (!horizontal && this.textAutoResize === 'HEIGHT') ? 'HUG' : 'FIXED';
    if (this.autoLayout(this)) return this.axisSizing[this.axisOf(horizontal)] === 'AUTO' ? 'HUG' : 'FIXED';
    return 'FIXED';
  }
  private setSizing(horizontal: boolean, v: string): void {
    if (v === 'FILL') {
      const p = this.parent;
      if (!p || !this.autoLayout(p)) throw new Error('FILL can only be set on children of auto-layout frames');
      if ((p.layoutMode === 'HORIZONTAL') === horizontal) this.layoutGrow = 1;
      else this.layoutAlign = 'STRETCH';
      if (this.type === 'TEXT' && horizontal && this.textAutoResize === 'WIDTH_AND_HEIGHT') this.textAutoResize = 'HEIGHT';
      return;
    }
    this.clearFill(horizontal);
    if (v === 'HUG') {
      if (this.type === 'TEXT') this.textAutoResize = horizontal ? 'WIDTH_AND_HEIGHT' : 'HEIGHT';
      else if (this.autoLayout(this)) this.axisSizing[this.axisOf(horizontal)] = 'AUTO';
      else throw new Error('HUG can only be set on auto-layout frames and text');
    } else if (this.autoLayout(this)) this.axisSizing[this.axisOf(horizontal)] = 'FIXED';
  }
  get layoutSizingHorizontal() {
    return this.sizing(true);
  }
  set layoutSizingHorizontal(v: string) {
    this.setSizing(true, v);
  }
  get layoutSizingVertical() {
    return this.sizing(false);
  }
  set layoutSizingVertical(v: string) {
    this.setSizing(false, v);
  }

  // Shared plugin data
  getSharedPluginData(ns: string, key: string) {
    return this.shared.get(`${ns}|${key}`) ?? '';
  }
  setSharedPluginData(ns: string, key: string, value: string) {
    if (value === '') this.shared.delete(`${ns}|${key}`);
    else this.shared.set(`${ns}|${key}`, value);
  }

  /** Components have a key (published or not); preferred values reference it. */
  get key(): string {
    if (this.type !== 'COMPONENT' && this.type !== 'COMPONENT_SET') throw new Error('Only components have a key');
    return `key-${this.id}`;
  }

  /** A copy of this node and its subtree, everything but identity (shared plugin data, bindings, paints, text). */
  copy(): SimNode {
    const n = new SimNode(this.type, this.api);
    for (const k of Object.keys(this)) {
      if (OWN.has(k)) continue;
      const v = (this as Dict)[k];
      (n as Dict)[k] = v && typeof v === 'object' ? structuredClone(v) : v;
    }
    n.mainId = this.mainId;
    for (const c of this.children) {
      const cc = c.copy();
      cc.parent = n;
      n.children.push(cc);
    }
    return n;
  }

  // Instances
  createInstance(): SimNode {
    if (this.type !== 'COMPONENT') throw new Error('createInstance needs a COMPONENT');
    this.api.fault('createInstance');
    const inst = this.copy();
    inst.type = 'INSTANCE';
    inst.mainId = this.id;
    // An instance carries the main component's look, not its identity or its properties.
    inst.props = new Map();
    inst.description = '';
    for (const k of ['iconId', 'slotId', 'iconHash', 'slotHash']) inst.setSharedPluginData('dsbridge', k, '');
    return inst;
  }
  async getMainComponentAsync(): Promise<SimNode | null> {
    await this.api.gate();
    if (this.type !== 'INSTANCE') throw new Error('Not an instance');
    return this.api.nodes.get(this.mainId) ?? null;
  }
  set mainComponent(_v: unknown) {
    throw new Error('mainComponent cannot be read or set with documentAccess dynamic-page: use getMainComponentAsync / swapComponent');
  }
  swapComponent(main: SimNode) {
    if (this.type !== 'INSTANCE' || main.type !== 'COMPONENT') throw new Error('swapComponent needs an instance and a component');
    const overrides = new Map<string, SimNode>();
    for (const c of this.findAll()) overrides.set(c.name, c);
    for (const c of [...this.children]) c.remove();
    const fresh = main.createInstance();
    for (const c of [...fresh.children]) {
      c.parent = this;
      this.children.push(c);
    }
    fresh.children = [];
    fresh.remove();
    for (const c of this.findAll()) {
      const old = overrides.get(c.name);
      if (!old || old.type !== c.type) continue;
      c.strokes = structuredClone(old.strokes);
      c.bound = new Map(old.bound);
    }
    this.mainId = main.id;
  }

  // Tree
  appendChild(child: SimNode) {
    if (!CONTAINERS.has(this.type)) throw new Error(`${this.type} cannot have children`);
    if (child.removed || this.removed) throw new Error('The node has been removed');
    this.api.fault('appendChild');
    child.detach();
    child.parent = this;
    this.children.push(child);
  }
  insertChild(index: number, child: SimNode) {
    if (!CONTAINERS.has(this.type)) throw new Error(`${this.type} cannot have children`);
    child.detach();
    child.parent = this;
    this.children.splice(index, 0, child);
  }
  /** appendChild without fault injection: for the inside of calls Figma does in one go (combineAsVariants, an SVG import). */
  attach(child: SimNode) {
    child.detach();
    child.parent = this;
    this.children.push(child);
  }
  private detach() {
    if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }
  remove() {
    if (this.removed) throw new Error('The node has been removed');
    this.api.ops++;
    this.detach();
    const drop = (n: SimNode) => {
      this.api.nodes.delete(n.id);
      for (const c of n.children) drop(c);
    };
    drop(this);
  }
  findAll(cb: (n: SimNode) => boolean = () => true): SimNode[] {
    const out: SimNode[] = [];
    const walk = (n: SimNode) => {
      for (const c of n.children) {
        if (cb(c)) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  findOne(cb: (n: SimNode) => boolean): SimNode | null {
    return this.findAll(cb)[0] ?? null;
  }
  findAllWithCriteria(c: { types: string[] }): SimNode[] {
    return this.findAll((n) => c.types.includes(n.type));
  }
  resize(w: number, h: number) {
    this.size = { width: w, height: h };
  }
  resizeWithoutConstraints(w: number, h: number) {
    this.resize(w, h);
  }
  async loadAsync() {}

  // Variables
  setBoundVariable(field: string, variable: SimVariable | null) {
    // As Figma: a field the node does not have is refused, bound or unbound.
    const bindable = this.type === 'TEXT' ? TEXT_BINDABLE : FRAME_BINDABLE;
    if (!bindable.has(field)) throw new Error(`in setBoundVariable: Invalid field "${field}" for ${this.type}`);
    if (variable) this.api.fault('setBoundVariable');
    if (variable && !this.api.variables.includes(variable)) throw new Error('in setBoundVariable: variable not found');
    if (!variable) this.bound.delete(field);
    else {
      if (variable.resolvedType !== (field === 'fontFamily' || field === 'fontStyle' || field === 'characters' ? 'STRING' : field === 'visible' ? 'BOOLEAN' : 'FLOAT'))
        throw new Error(`Cannot bind a ${variable.resolvedType} variable to ${field}`);
      if (this.type === 'TEXT' && field === 'fontWeight' && !this.api.loadedFonts.has(`${this._fontName.family}|${this._fontName.style}`)) throw new Error('Font not loaded');
      this.bound.set(field, { type: 'VARIABLE_ALIAS', id: variable.id });
    }
  }
  get boundVariables(): Record<string, unknown> {
    const out: Record<string, unknown> = Object.fromEntries(this.bound);
    const paints = (ps: Dict[]) => ps.map((p) => (p.boundVariables as Dict | undefined)?.color).filter(Boolean);
    if (paints(this.fills).length) out.fills = paints(this.fills);
    if (paints(this.strokes).length) out.strokes = paints(this.strokes);
    return out;
  }

  // Text. As in Figma: changing what lays text out needs the text's font loaded first.
  private _text: Record<string, unknown> = {};
  private needsFont(field: string) {
    if (this.type === 'TEXT' && !this.api.loadedFonts.has(`${this._fontName.family}|${this._fontName.style}`))
      throw new Error(`in set_${field}: Cannot write to node with unloaded font "${this._fontName.family} ${this._fontName.style}". Please call figma.loadFontAsync`);
  }
  get textAutoResize() {
    return this._text.textAutoResize;
  }
  set textAutoResize(v: unknown) {
    this.needsFont('textAutoResize');
    this._text.textAutoResize = v;
  }
  get fontSize() {
    return this._text.fontSize;
  }
  set fontSize(v: unknown) {
    this.needsFont('fontSize');
    this._text.fontSize = v;
  }
  get lineHeight() {
    return this._text.lineHeight;
  }
  set lineHeight(v: unknown) {
    this.needsFont('lineHeight');
    this._text.lineHeight = v;
  }
  get letterSpacing() {
    return this._text.letterSpacing;
  }
  set letterSpacing(v: unknown) {
    this.needsFont('letterSpacing');
    this._text.letterSpacing = v;
  }
  get textDecoration() {
    return this._text.textDecoration;
  }
  set textDecoration(v: unknown) {
    this.needsFont('textDecoration');
    this._text.textDecoration = v;
  }
  get removed() {
    return !this.api.nodes.has(this.id);
  }
  get characters() {
    return this._characters;
  }
  set characters(v: string) {
    if (!this.api.loadedFonts.has(`${this._fontName.family}|${this._fontName.style}`)) throw new Error(`Font "${this._fontName.family} ${this._fontName.style}" is not loaded`);
    this._characters = v;
  }
  get fontName() {
    return this._fontName;
  }
  set fontName(f: { family: string; style: string }) {
    if (!this.api.loadedFonts.has(`${f.family}|${f.style}`)) throw new Error(`Font "${f.family} ${f.style}" is not loaded`);
    this._fontName = { ...f };
  }

  // Components
  get variantProperties(): Record<string, string> | null {
    if (this.type !== 'COMPONENT' || this.parent?.type !== 'COMPONENT_SET') return null;
    // Like Figma: every variant of a set is named "Prop=value, ...", with the same properties and no two alike, or
    // the set is in error and reading any of its variants throws.
    const parse = (name: string) => {
      const pairs = name.split(',').map((p) => p.split('=').map((x) => x.trim()));
      return pairs.every((p) => p.length === 2 && p[0] && p[1]) ? (Object.fromEntries(pairs) as Record<string, string>) : null;
    };
    const siblings = this.parent.children.filter((c) => c.type === 'COMPONENT').map((c) => parse(c.name));
    const shape = (p: Record<string, string>) => Object.keys(p).sort().join('|');
    const combos = siblings.map((p) => (p ? JSON.stringify(Object.entries(p).sort()) : ''));
    const broken = siblings.some((p) => !p || shape(p) !== shape(siblings[0]!)) || new Set(combos).size !== combos.length;
    if (broken) throw new Error('in get_variantProperties: Component set for node has existing errors');
    return parse(this.name);
  }
  get componentPropertyDefinitions(): Record<string, { type: string; defaultValue: string | boolean; variantOptions?: string[]; preferredValues?: { type: string; key: string }[] }> {
    if (this.type !== 'COMPONENT_SET' && this.type !== 'COMPONENT') throw new Error('Not a component');
    const out: Record<string, { type: string; defaultValue: string | boolean; variantOptions?: string[]; preferredValues?: { type: string; key: string }[] }> = {};
    if (this.type === 'COMPONENT_SET') {
      const axes = new Map<string, string[]>();
      for (const c of this.children) for (const [k, v] of Object.entries(c.variantProperties ?? {})) axes.set(k, [...new Set([...(axes.get(k) ?? []), v])]);
      for (const [k, values] of axes) out[k] = { type: 'VARIANT', defaultValue: values[0]!, variantOptions: values };
    }
    for (const [k, d] of this.props) out[k] = structuredClone(d);
    return out;
  }
  private checkSwap(type: string, defaultValue: unknown, preferred?: { type: string; key: string }[]) {
    if (type !== 'INSTANCE_SWAP') {
      if (preferred) throw new Error('preferredValues is only supported for INSTANCE_SWAP properties');
      return;
    }
    if (this.api.nodes.get(String(defaultValue))?.type !== 'COMPONENT') throw new Error('The default of an INSTANCE_SWAP property must be a component id');
    for (const p of preferred ?? []) {
      const n = this.api.nodes.get(p.key.replace(/^key-/, ''));
      if (n?.type !== 'COMPONENT') throw new Error(`No component with key ${p.key}`);
    }
  }
  addComponentProperty(name: string, type: string, defaultValue: string | boolean, options?: { preferredValues?: { type: string; key: string }[] }) {
    this.api.fault('addComponentProperty');
    if (this.type !== 'COMPONENT_SET' && !(this.type === 'COMPONENT' && this.parent?.type !== 'COMPONENT_SET')) throw new Error('Can only add component properties to a component set or a lone component');
    if (typeof name !== 'string' || !name.trim()) throw new Error('A component property needs a name');
    if (type === 'BOOLEAN' && typeof defaultValue !== 'boolean') throw new Error('in addComponentProperty: BOOLEAN default must be a boolean');
    if (type === 'TEXT' && typeof defaultValue !== 'string') throw new Error('in addComponentProperty: TEXT default must be a string');
    if ([...this.props.keys()].some((k) => k.replace(/#[^#]*$/, '') === name && this.props.get(k)!.type === type)) throw new Error(`in addComponentProperty: a ${type} property "${name}" already exists`);
    this.checkSwap(type, defaultValue, options?.preferredValues);
    const key = `${name}#${++seq}:0`;
    this.props.set(key, { type, defaultValue, ...(options?.preferredValues ? { preferredValues: structuredClone(options.preferredValues) } : {}) });
    return key;
  }
  editComponentProperty(key: string, patch: { defaultValue?: string | boolean; preferredValues?: { type: string; key: string }[] }) {
    const d = this.props.get(key);
    if (!d) throw new Error(`No property ${key}`);
    this.checkSwap(d.type, patch.defaultValue ?? d.defaultValue, patch.preferredValues);
    if (patch.defaultValue !== undefined) d.defaultValue = patch.defaultValue;
    if (patch.preferredValues) d.preferredValues = structuredClone(patch.preferredValues);
    return key;
  }
  deleteComponentProperty(key: string) {
    if (!this.props.delete(key)) throw new Error(`No property ${key}`);
    // Layers that referenced it lose the reference, as in Figma.
    for (const n of this.findAll()) {
      const refs = n.componentPropertyReferences;
      if (!refs) continue;
      const kept = Object.fromEntries(Object.entries(refs).filter(([, v]) => v !== key));
      n.componentPropertyReferences = Object.keys(kept).length ? kept : null;
    }
  }

  // Prototype reactions. With documentAccess dynamic-page, `reactions` is read only: setReactionsAsync writes them.
  private _reactions: Dict[] = [];
  get reactions(): Dict[] {
    // As Figma reads them: mouse enter and leave triggers carry deprecatedVersion, which setReactionsAsync refuses.
    return structuredClone(this._reactions).map((r) => {
      const t = r.trigger as Dict | null;
      return t && (t.type === 'MOUSE_ENTER' || t.type === 'MOUSE_LEAVE') ? { ...r, trigger: { ...t, deprecatedVersion: false } } : r;
    });
  }
  set reactions(_v: unknown) {
    throw new Error('reactions is read only with documentAccess dynamic-page: use setReactionsAsync');
  }
  async setReactionsAsync(reactions: Dict[]): Promise<void> {
    await this.api.gate();
    const out: Dict[] = [];
    for (const r of reactions) {
      const trigger = r.trigger as Dict | null;
      const type = trigger?.type as string;
      if (!['ON_CLICK', 'ON_HOVER', 'ON_PRESS', 'ON_DRAG', 'MOUSE_ENTER', 'MOUSE_LEAVE', 'MOUSE_UP', 'MOUSE_DOWN', 'AFTER_TIMEOUT'].includes(type)) throw new Error(`Invalid trigger ${String(type)}`);
      if (['MOUSE_ENTER', 'MOUSE_LEAVE', 'MOUSE_UP', 'MOUSE_DOWN'].includes(type) && typeof trigger!.delay !== 'number') throw new Error(`${type} needs delay`);
      // As Figma: any key outside the documented shape fails the whole call (deprecatedVersion included).
      const allowed = ['type', ...(['MOUSE_ENTER', 'MOUSE_LEAVE', 'MOUSE_UP', 'MOUSE_DOWN'].includes(type) ? ['delay'] : type === 'AFTER_TIMEOUT' ? ['timeout'] : [])];
      const stray = Object.keys(trigger!).find((k) => !allowed.includes(k));
      if (stray) throw new Error(`in setReactionsAsync: Property "reactions" failed validation: Unrecognized key: "${stray}" at [${reactions.indexOf(r)}].trigger`);
      if (this.api.rejectReactions?.(this)) throw new Error('in setReactionsAsync: Property "reactions" failed validation');
      const actions = (r.actions ?? (r.action ? [r.action] : [])) as Dict[];
      for (const a of actions) {
        if (a.type !== 'NODE') continue;
        const dest = this.api.nodes.get(a.destinationId as string);
        if (!dest) throw new Error(`No node ${String(a.destinationId)}`);
        if (a.navigation === 'CHANGE_TO' && (this.type !== 'COMPONENT' || dest.type !== 'COMPONENT' || dest.parent !== this.parent || this.parent?.type !== 'COMPONENT_SET')) throw new Error('CHANGE_TO goes to another variant of the same component set');
        const t = a.transition as Dict | null;
        if (t) {
          if (t.type !== 'SMART_ANIMATE' && t.type !== 'DISSOLVE') throw new Error(`Unexpected transition ${String(t.type)}`);
          if (!(typeof t.duration === 'number' && t.duration > 0)) throw new Error('A transition needs a duration in seconds');
          const easing = t.easing as Dict;
          if (easing.type === 'CUSTOM_CUBIC_BEZIER' && !easing.easingFunctionCubicBezier) throw new Error('CUSTOM_CUBIC_BEZIER needs easingFunctionCubicBezier');
          // Figma stores durations as float32.
          t.duration = Math.fround(t.duration as number);
        }
      }
      // Figma returns the first action as `action` too.
      out.push({ trigger: structuredClone(trigger), action: structuredClone(actions[0] ?? null), actions: structuredClone(actions) });
    }
    this._reactions = out;
    this.api.reactionWrites++;
  }

  // Export: a description of what Figma would draw, bound values resolved.
  async exportAsync(): Promise<Uint8Array> {
    await this.api.gate();
    return new TextEncoder().encode(JSON.stringify(this.api.render(this)));
  }
}

export class SimFigma {
  nodes = new Map<string, SimNode>();
  collections: SimCollection[] = [];
  variables: SimVariable[] = [];
  loadedFonts = new Set<string>();
  /** Max modes per collection (free plan: 1). 0 = unlimited. */
  modeLimit = 0;
  fonts: { family: string; style: string }[];
  root: SimNode;
  currentPage: SimNode;
  fileKey: string | undefined = undefined;
  notices: string[] = [];
  /** setReactionsAsync calls, to check a second pull writes nothing. */
  reactionWrites = 0;
  /** When set and true for a node, setReactionsAsync fails there, as Figma does on a reaction it cannot validate. */
  rejectReactions: ((node: SimNode) => boolean) | undefined = undefined;
  /** Max nodes in the file (0 = no limit): creating more throws, as Figma does when a file runs out of memory. */
  nodeLimit = 0;
  /** Fault injection: the share of Figma calls that fail (0 to 1), from a seeded random sequence, so a run replays. */
  faultRate = 0;
  private faultSeed = 1;
  /** Fonts Figma lists but refuses to load (a broken font file, a missing local font). */
  brokenFonts = new Set<string>();
  /** Calls to the API that write, counted for the budget of a big pull. */
  ops = 0;
  faults = 0;
  seedFaults(seed: number, rate: number) {
    this.faultSeed = seed || 1;
    this.faultRate = rate;
  }
  /** Called by every write: counts it and, with fault injection on, fails some of them like Figma refusing a call. */
  fault(op: string) {
    this.ops++;
    if (!this.faultRate) return;
    // xorshift32: deterministic for a seed.
    let x = this.faultSeed;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.faultSeed = x >>> 0;
    if (this.faultSeed / 0xffffffff < this.faultRate) {
      this.faults++;
      throw new Error(`in ${op}: injected failure`);
    }
  }

  constructor(opts: { fonts?: { family: string; style: string }[] } = {}) {
    this.fonts = opts.fonts ?? ['Regular', 'Medium', 'Semi Bold', 'Bold'].flatMap((style) => [{ family: 'Inter', style }, { family: 'Instrument Sans', style }, { family: 'Fraunces', style }, { family: 'IBM Plex Mono', style }]);
    this.root = new SimNode('DOCUMENT', this);
    this.root.name = 'Test file';
    this.currentPage = this.createPage();
    this.currentPage.name = 'Page 1';
  }

  /** The `figma` global. */
  api(): unknown {
    const self = this;
    return {
      root: self.root,
      get currentPage() {
        return self.currentPage;
      },
      get fileKey() {
        return self.fileKey;
      },
      loadAllPagesAsync: async () => {},
      createPage: () => self.createPage(),
      // As in Figma: a new node starts on the current page until it is moved into place.
      createFrame: () => self.onPage(new SimNode('FRAME', self), 'createFrame'),
      createComponent: () => self.onPage(new SimNode('COMPONENT', self), 'createComponent'),
      createText: () => self.onPage(new SimNode('TEXT', self), 'createText'),
      createNodeFromSvg: (svg: string) => {
        self.fault('createNodeFromSvg');
        const shapes = svg.match(/<(path|circle|rect|line|polyline|polygon|ellipse)\b[^>]*>/g);
        if (!/^<svg[\s>]/.test(svg) || !shapes) throw new Error('Invalid SVG');
        const frame = new SimNode('FRAME', self);
        frame.resize(24, 24);
        self.currentPage.attach(frame);
        for (const shape of shapes) {
          const v = new SimNode('VECTOR', self);
          v.name = 'Vector';
          v.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
          v.strokeWeight = 2;
          v.svgShape = shape;
          frame.attach(v);
        }
        return frame;
      },
      flatten: (nodes: SimNode[], parent?: SimNode) => {
        if (!nodes.length) throw new Error('flatten needs at least one node');
        if (nodes.some((n) => n.parent?.type === 'INSTANCE')) throw new Error('Cannot flatten children of instances');
        const v = new SimNode('VECTOR', self);
        v.name = 'Vector';
        v.strokes = structuredClone(nodes[0]!.strokes);
        v.strokeWeight = nodes[0]!.strokeWeight;
        v.paths = nodes.map((n) => n.svgShape ?? n.paths).join('');
        v.resize(24, 24);
        (parent ?? self.currentPage).attach(v);
        for (const n of nodes) n.remove();
        return v;
      },
      combineAsVariants: (nodes: SimNode[], parent: SimNode) => {
        if (!nodes.length) throw new Error('combineAsVariants needs at least one component');
        self.fault('combineAsVariants');
        if (nodes.some((n) => n.type !== 'COMPONENT')) throw new Error('Only components can be combined');
        const set = new SimNode('COMPONENT_SET', self);
        parent.attach(set);
        for (const n of nodes) set.attach(n);
        return set;
      },
      getNodeByIdAsync: async (id: string) => self.nodes.get(id) ?? null,
      getStyleByIdAsync: async () => null,
      listAvailableFontsAsync: async () => self.fonts.map((fontName) => ({ fontName })),
      loadFontAsync: async (f: { family: string; style: string }) => {
        await self.gate();
        self.fontLoads++;
        if (!self.fonts.some((x) => x.family === f.family && x.style === f.style)) throw new Error(`Font ${f.family} ${f.style} is not available`);
        if (self.brokenFonts.has(`${f.family}|${f.style}`)) throw new Error(`in loadFontAsync: could not load font ${f.family} ${f.style}`);
        self.fault('loadFontAsync');
        self.loadedFonts.add(`${f.family}|${f.style}`);
      },
      notify: (m: string) => self.notices.push(m),
      ui: { postMessage: () => {} },
      base64Encode: (b: Uint8Array) => Buffer.from(b).toString('base64'),
      variables: {
        getLocalVariableCollectionsAsync: async () => [...self.collections],
        getLocalVariablesAsync: async () => self.variables.filter((v) => self.collections.some((c) => c.id === v.variableCollectionId)),
        getVariableByIdAsync: async (id: string) => self.variables.find((v) => v.id === id) ?? null,
        createVariableCollection: (name: string) => {
          const c = new SimCollection(name, self);
          self.collections.push(c);
          return c;
        },
        createVariable: (name: string, collection: SimCollection, type: string) => {
          if (self.variables.some((v) => v.variableCollectionId === collection.id && v.name === name)) throw new Error(`Variable ${name} already exists`);
          const v = new SimVariable(name, collection.id, type, self);
          self.variables.push(v);
          return v;
        },
        createVariableAlias: (v: SimVariable): Alias => ({ type: 'VARIABLE_ALIAS', id: v.id }),
        setBoundVariableForPaint: (paint: Dict, field: string, v: SimVariable | null) => {
          if (field !== 'color') throw new Error('Only color can be bound on a paint');
          if (v && v.resolvedType !== 'COLOR') throw new Error('Paint color needs a COLOR variable');
          return { ...paint, boundVariables: v ? { color: { type: 'VARIABLE_ALIAS', id: v.id } } : {} };
        },
      },
    };
  }

  /** From this op count on, async calls never answer (0 = off): the plugin stops where it is, as when the file closes. */
  hangAfter = 0;
  hung = false;
  async gate(): Promise<void> {
    if (this.hangAfter && this.ops >= this.hangAfter) {
      this.hung = true;
      await new Promise(() => undefined);
    }
  }

  /** loadFontAsync calls: each font is loaded once per pull. */
  fontLoads = 0;

  onPage(n: SimNode, op: string): SimNode {
    this.currentPage.attach(n);
    try {
      this.fault(op);
    } catch (err) {
      // Figma refused the call: nothing was created.
      n.remove();
      throw err;
    }
    return n;
  }

  /** Layers left loose on a page by a build: anything on a page that is not a generated set, icon or slot. */
  loose(): SimNode[] {
    return this.root.children.flatMap((page) =>
      page.children.filter(
        (n) => !(n.type === 'COMPONENT_SET' && n.getSharedPluginData('dsbridge', 'componentId')) && !(n.type === 'COMPONENT' && (n.getSharedPluginData('dsbridge', 'iconId') || n.getSharedPluginData('dsbridge', 'slotId'))),
      ),
    );
  }

  createPage(): SimNode {
    const p = new SimNode('PAGE', this);
    this.root.appendChild(p);
    return p;
  }

  install(): this {
    (globalThis as unknown as { figma: unknown }).figma = this.api();
    return this;
  }

  /** A variable's value in each collection's default mode, aliases followed. */
  resolveVariable(v: SimVariable, depth = 0): unknown {
    const c = this.collections.find((x) => x.id === v.variableCollectionId);
    const raw = v.valuesByMode[c?.defaultModeId ?? ''] ?? Object.values(v.valuesByMode)[0];
    if (raw && typeof raw === 'object' && (raw as Alias).type === 'VARIABLE_ALIAS' && depth < 20) {
      const t = this.variables.find((x) => x.id === (raw as Alias).id);
      return t ? this.resolveVariable(t, depth + 1) : undefined;
    }
    return raw;
  }

  render(n: SimNode): unknown {
    const value = (a: unknown) => {
      const v = this.variables.find((x) => x.id === (a as Alias).id);
      return v ? this.resolveVariable(v) : 'missing';
    };
    const paint = (p: Dict) => ((p.boundVariables as Dict | undefined)?.color ? value((p.boundVariables as Dict).color) : p.color);
    const fields = ['layoutMode', 'primaryAxisAlignItems', 'counterAxisAlignItems', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'itemSpacing', 'cornerRadius', 'strokeWeight', 'lineHeight', 'letterSpacing', 'visible', 'clipsContent', 'textAutoResize', 'minHeight'];
    return {
      type: n.type,
      fills: n.fills.map(paint),
      strokes: n.strokes.map(paint),
      own: Object.fromEntries(fields.map((f) => [f, n[f]]).filter(([, v]) => v !== undefined)),
      bound: Object.fromEntries(Object.entries(n.boundVariables).filter(([k]) => k !== 'fills' && k !== 'strokes').map(([k, a]) => [k, value(a)])),
      text: n.type === 'TEXT' ? [n.characters, n.fontName] : undefined,
      paths: n.type === 'VECTOR' ? n.paths : undefined,
      size: n.type === 'INSTANCE' || n.type === 'VECTOR' ? [n.width, n.height] : undefined,
      children: n.children.map((c) => this.render(c)),
    };
  }

  /** Every generated component set on every page. */
  sets(): SimNode[] {
    return this.root.findAllWithCriteria({ types: ['COMPONENT_SET'] });
  }
}
