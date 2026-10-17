// An in-memory stand-in for the parts of the Figma Plugin API that the main thread uses to write variables
// (src/main/apply.ts), build component sets (src/main/build-components.ts) and read component signatures
// (src/main/components.ts). Installed as the global `figma` for a test. It models what those files rely on (nodes,
// shared plugin data, variable bindings, component properties, variants, fonts that must be loaded before text is
// set), not Figma's renderer: exportAsync returns a hash-friendly description of the node tree with bound values
// resolved, so a render hash moves when a bound value moves.

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
  setPluginData(k: string, v: string) {
    this.pd.set(k, v);
  }
  /** Resolved in each collection's default mode (the sim has no explicit modes on nodes). */
  resolveForConsumer(_node: unknown): { value: unknown; resolvedType: string } {
    return { value: this.api.resolveVariable(this), resolvedType: this.resolvedType };
  }
}

const CONTAINERS = new Set(['DOCUMENT', 'PAGE', 'FRAME', 'COMPONENT', 'COMPONENT_SET']);

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
  private props = new Map<string, { type: string; defaultValue: string | boolean }>();
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

  // Tree
  appendChild(child: SimNode) {
    if (!CONTAINERS.has(this.type)) throw new Error(`${this.type} cannot have children`);
    child.detach();
    child.parent = this;
    this.children.push(child);
  }
  insertChild(index: number, child: SimNode) {
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
  get componentPropertyDefinitions(): Record<string, { type: string; defaultValue: string | boolean; variantOptions?: string[] }> {
    if (this.type !== 'COMPONENT_SET' && this.type !== 'COMPONENT') throw new Error('Not a component');
    const out: Record<string, { type: string; defaultValue: string | boolean; variantOptions?: string[] }> = {};
    if (this.type === 'COMPONENT_SET') {
      const axes = new Map<string, string[]>();
      for (const c of this.children) for (const [k, v] of Object.entries(c.variantProperties ?? {})) axes.set(k, [...new Set([...(axes.get(k) ?? []), v])]);
      for (const [k, values] of axes) out[k] = { type: 'VARIANT', defaultValue: values[0]!, variantOptions: values };
    }
    for (const [k, d] of this.props) out[k] = { ...d };
    return out;
  }
  addComponentProperty(name: string, type: string, defaultValue: string | boolean) {
    const key = `${name}#${++seq}:0`;
    this.props.set(key, { type, defaultValue });
    return key;
  }
  editComponentProperty(key: string, patch: { defaultValue?: string | boolean }) {
    const d = this.props.get(key);
    if (!d) throw new Error(`No property ${key}`);
    if (patch.defaultValue !== undefined) d.defaultValue = patch.defaultValue;
    return key;
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

  constructor(opts: { fonts?: { family: string; style: string }[] } = {}) {
    this.fonts = opts.fonts ?? ['Regular', 'Medium', 'Semi Bold', 'Bold'].flatMap((style) => [{ family: 'Inter', style }, { family: 'Instrument Sans', style }, { family: 'Fraunces', style }]);
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
      children: n.children.map((c) => this.render(c)),
    };
  }

  /** Every generated component set on every page. */
  sets(): SimNode[] {
    return this.root.findAllWithCriteria({ types: ['COMPONENT_SET'] });
  }
}
