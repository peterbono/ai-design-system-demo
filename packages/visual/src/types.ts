// Shapes shared by the selection, the capture, the diff and the manifest that the CLI, the MCP tool, the
// GitHub workflow and the docs site read.

export type Only = 'stories' | 'app';

export interface Mode {
  brand: string;
  theme: string;
}

export interface StoryEntry {
  id: string;
  title: string;
  name: string;
  importPath: string;
}

export interface AppRoute {
  /** Stable key used in file names: "orders-list". */
  id: string;
  label: string;
  /** Hash route of the admin app (ra-core uses a hash router): "/orders". */
  path: string;
  /** Per-tenant path when record ids differ between seeded datasets (tenant id -> path). */
  pathByTenant?: Record<string, string>;
  /** CSS selector that must be visible before the screenshot (a drawer, a form). */
  waitFor?: string;
  /** Extra selectors painted over before the screenshot (volatile content). */
  mask?: string[];
}

export interface Tenant {
  id: string;
  name: string;
  brand: string;
}

export interface SelectedComponent {
  id: string;
  reasons: string[];
  indirect: boolean;
}

export interface Selection {
  /** Token paths whose resolved value differs between base and head, direct edits first. */
  tokens: { path: string; kind: 'direct' | 'alias'; modes: string[] }[];
  vars: string[];
  files: string[];
  components: SelectedComponent[];
  /** Story ids to capture, AllStates first per component. */
  stories: string[];
  /** Why every AllStates story is captured instead of a targeted list, or null. */
  fallback: string | null;
  /** Whether the admin screens are captured, and why. */
  app: { include: boolean; reason: string };
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ShotStatus = 'changed' | 'unchanged' | 'added' | 'removed' | 'error';

export interface ShotResult {
  /** File-safe key: "story__feedback-alert--all-states__bridge-light". */
  key: string;
  kind: 'story' | 'route';
  /** Human label: "Feedback/Alert: All states" or "Orders list". */
  label: string;
  storyId?: string;
  route?: string;
  tenant?: string;
  brand: string;
  theme: string;
  status: ShotStatus;
  changedPixels: number;
  totalPixels: number;
  /** Changed pixels in percent of the larger image, two decimals. */
  percent: number;
  boxes: Box[];
  size: { before: { width: number; height: number } | null; after: { width: number; height: number } | null };
  /** Paths relative to the manifest folder. Only changed shots keep diff and composite images. */
  images: { before?: string; after?: string; diff?: string; composite?: string };
  error?: string;
}

export interface Manifest {
  version: 1;
  tool: '@bridge-ds/visual';
  createdAt: string;
  durationMs: number;
  base: { ref: string; sha: string };
  head: { ref: string; sha: string };
  options: { only: Only[]; threshold: number; plan?: boolean; planned?: { modes: number; appScreens: number }; viewport: { stories: Viewport; app: Viewport } };
  selection: Selection;
  summary: Summary;
  shots: ShotResult[];
}

export interface Summary {
  shots: number;
  changed: number;
  unchanged: number;
  added: number;
  removed: number;
  errors: number;
  /** Largest change, in percent. */
  maxPercent: number;
}

export interface Viewport {
  width: number;
  height: number;
}
