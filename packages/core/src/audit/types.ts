// Types of the `bridge audit` report: design-system adoption and drift in a product codebase.
// The JSON report is versioned (`schemaVersion`); packages/core/audit-report.schema.json describes it.

export const AUDIT_SCHEMA_VERSION = 1;

/** What a hardcoded value stands for. */
export type FindingCategory =
  | 'color'
  | 'spacing'
  | 'size'
  | 'radius'
  | 'border-width'
  | 'shadow'
  | 'duration'
  | 'easing'
  | 'z-index'
  | 'font-family'
  | 'font-size'
  | 'font-weight'
  | 'line-height';

export const FINDING_CATEGORIES: FindingCategory[] = ['color', 'spacing', 'size', 'radius', 'border-width', 'shadow', 'duration', 'easing', 'z-index', 'font-family', 'font-size', 'font-weight', 'line-height'];

/** Where a value was written. */
export type FindingSource = 'css' | 'style' | 'sx' | 'styled' | 'theme' | 'tailwind' | 'jsx-attr' | 'js';

export type Confidence = 'exact' | 'high' | 'medium' | 'low';

export interface TokenSuggestion {
  /** Token path, e.g. color.text.muted. */
  token: string;
  /** CSS variable, e.g. --color-text-muted. */
  cssVar: string;
  /** Resolved token value in the mode it matched. */
  value: string;
  /** Mode combination the value matched in (colors), e.g. "theme=dark". Absent for the default mode. */
  mode?: string;
  /** deltaE OK x 100 for colors, px for lengths, ms for durations, steps otherwise. 0 = exact. */
  distance: number;
  /** 0..1 */
  confidence: number;
  level: Confidence;
}

export interface StyleFinding {
  line: number;
  column: number;
  category: FindingCategory;
  /** CSS property (kebab-case) or object key the value belongs to. */
  property?: string;
  /** The literal as written: "#1976d2", "13px", "p-[13px]". */
  value: string;
  source: FindingSource;
  suggestion?: TokenSuggestion;
  /** `bridge audit --fix` can replace it (exact token match in a CSS file). */
  autofix?: boolean;
}

export type ComponentKind = 'ds' | 'foreign' | 'native' | 'recreated';

export interface ComponentFinding {
  line: number;
  column: number;
  /** JSX name as written: Button, Card.Header, button. */
  name: string;
  kind: Exclude<ComponentKind, 'ds'>;
  /** Package or origin: @mui/material, react-admin, shadcn/ui (local), native, local. */
  library: string;
  /** DS component to use instead, when one fits. */
  suggestion?: string;
}

export interface FileReport {
  /** Path relative to the audited root, with forward slashes. */
  path: string;
  lang: 'css' | 'scss' | 'less' | 'tsx' | 'jsx' | 'ts' | 'js';
  tokenUsages: number;
  /** References to another theme (MUI theme, Tailwind scale classes): not hardcoded, not the DS either. */
  themeRefs: number;
  hardcoded: number;
  dsComponents: number;
  /** Foreign, native and re-created component instances. */
  otherComponents: number;
  findings: StyleFinding[];
  components: ComponentFinding[];
}

export interface CategoryCount {
  hardcoded: number;
  /** Findings whose value equals a token (safe to replace). */
  exact: number;
  /** Findings with a token suggestion of any confidence. */
  suggested: number;
}

export interface TopFix {
  category: FindingCategory;
  value: string;
  count: number;
  files: number;
  suggestion?: TokenSuggestion;
}

export interface AuditMetrics {
  /** token usages / (token usages + hardcoded), in percent, one decimal. Null when the code has no style value at all. */
  tokenAdoption: number | null;
  /** DS component instances / all UI component instances, in percent, one decimal. Null without UI components. */
  componentAdoption: number | null;
  tokenUsages: number;
  hardcoded: number;
  themeRefs: number;
  dsComponentInstances: number;
  uiComponentInstances: number;
}

export interface HistoryPoint {
  label?: string;
  generatedAt: string;
  tokenAdoption: number | null;
  componentAdoption: number | null;
  hardcoded: number;
  uiComponentInstances: number;
  dsComponentInstances: number;
}

export interface BaselineDiff {
  label?: string;
  generatedAt: string;
  tokenAdoption: { before: number | null; after: number | null; delta: number | null };
  componentAdoption: { before: number | null; after: number | null; delta: number | null };
  hardcoded: { before: number; after: number; delta: number };
  byCategory: Partial<Record<FindingCategory, { before: number; after: number; delta: number }>>;
  /** Files with fewer hardcoded values or non-DS components than in the baseline. */
  improved: { path: string; before: number; after: number }[];
  regressed: { path: string; before: number; after: number }[];
  newFiles: string[];
  removedFiles: string[];
}

export interface AuditReport {
  $schema?: string;
  schemaVersion: typeof AUDIT_SCHEMA_VERSION;
  tool: { name: 'bridge'; version: string };
  label?: string;
  generatedAt: string;
  target: { path: string; files: number; skipped: number };
  designSystem: { packages: string[]; components: number; tokens: number; modes: string[] };
  metrics: AuditMetrics;
  byCategory: Partial<Record<FindingCategory, CategoryCount>>;
  components: {
    ds: Record<string, number>;
    foreign: Record<string, { instances: number; components: Record<string, number> }>;
    native: Record<string, number>;
    recreated: { name: string; file: string; line: number; instances: number }[];
  };
  topFiles: { path: string; hardcoded: number; otherComponents: number; tokenUsages: number; dsComponents: number }[];
  topFixes: TopFix[];
  files: FileReport[];
  baseline?: BaselineDiff;
  /** Earlier runs, oldest first (carried over from the baseline). */
  history: HistoryPoint[];
}
