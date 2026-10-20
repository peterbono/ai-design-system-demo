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
/** Fields a copy never shares with its source. */
const OWN = new Set(['id', 'parent', 'children', 'api', 'mainId']);

export class SimNode {
  id: string;
  name = '';
  parent: SimNode | null = null;
  children: SimNode[] = [];
  x = 0;
  y = 0;
  width = 100;
  height = 40;
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
    this.id = nextId(type === 'PAGE' ? '0' : '1');
    api.nodes.set(this.id, this);
    if (type === 'TEXT') {
      this.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
      this.textAutoResize = 'WIDTH_AND_HEIGHT';
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
  private detach() {
    if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }
  remove() {
    this.detach();
    this.api.nodes.delete(this.id);
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
    this.width = w;
    this.height = h;
  }
  resizeWithoutConstraints(w: number, h: number) {
    this.resize(w, h);
  }
  async loadAsync() {}

  // Variables
  setBoundVariable(field: string, variable: SimVariable | null) {
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

  // Text
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
    return Object.fromEntries(
      this.name
        .split(',')
        .map((p) => p.split('=').map((x) => x.trim()))
        .filter((p) => p.length === 2) as [string, string][],
    );
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
    for (const p of preferred ?? []) if (![...this.api.nodes.values()].some((n) => n.type === 'COMPONENT' && n.key === p.key)) throw new Error(`No component with key ${p.key}`);
  }
  addComponentProperty(name: string, type: string, defaultValue: string | boolean, options?: { preferredValues?: { type: string; key: string }[] }) {
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
    return structuredClone(this._reactions);
  }
  set reactions(_v: unknown) {
    throw new Error('reactions is read only with documentAccess dynamic-page: use setReactionsAsync');
  }
  async setReactionsAsync(reactions: Dict[]): Promise<void> {
    const out: Dict[] = [];
    for (const r of reactions) {
      const trigger = r.trigger as Dict | null;
      const type = trigger?.type as string;
      if (!['ON_CLICK', 'ON_HOVER', 'ON_PRESS', 'ON_DRAG', 'MOUSE_ENTER', 'MOUSE_LEAVE', 'MOUSE_UP', 'MOUSE_DOWN', 'AFTER_TIMEOUT'].includes(type)) throw new Error(`Invalid trigger ${String(type)}`);
      if ((type === 'MOUSE_ENTER' || type === 'MOUSE_LEAVE') && (typeof trigger!.delay !== 'number' || typeof trigger!.deprecatedVersion !== 'boolean')) throw new Error(`${type} needs delay and deprecatedVersion`);
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
      createFrame: () => new SimNode('FRAME', self),
      createComponent: () => new SimNode('COMPONENT', self),
      createText: () => new SimNode('TEXT', self),
      createNodeFromSvg: (svg: string) => {
        const shapes = svg.match(/<(path|circle|rect|line|polyline|polygon|ellipse)\b[^>]*>/g);
        if (!/^<svg[\s>]/.test(svg) || !shapes) throw new Error('Invalid SVG');
        const frame = new SimNode('FRAME', self);
        frame.resize(24, 24);
        self.currentPage.appendChild(frame);
        for (const shape of shapes) {
          const v = new SimNode('VECTOR', self);
          v.name = 'Vector';
          v.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
          v.strokeWeight = 2;
          v.svgShape = shape;
          frame.appendChild(v);
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
        (parent ?? self.currentPage).appendChild(v);
        for (const n of nodes) n.remove();
        return v;
      },
      combineAsVariants: (nodes: SimNode[], parent: SimNode) => {
        if (!nodes.length) throw new Error('combineAsVariants needs at least one component');
        const set = new SimNode('COMPONENT_SET', self);
        parent.appendChild(set);
        for (const n of nodes) {
          if (n.type !== 'COMPONENT') throw new Error('Only components can be combined');
          set.appendChild(n);
        }
        return set;
      },
      getNodeByIdAsync: async (id: string) => self.nodes.get(id) ?? null,
      getStyleByIdAsync: async () => null,
      listAvailableFontsAsync: async () => self.fonts.map((fontName) => ({ fontName })),
      loadFontAsync: async (f: { family: string; style: string }) => {
        if (!self.fonts.some((x) => x.family === f.family && x.style === f.style)) throw new Error(`Font ${f.family} ${f.style} is not available`);
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
