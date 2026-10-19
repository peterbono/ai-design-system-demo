// Renders the declarative examples from <Name>.docs.json with the real components from @bridge-ds/react.
// Rendered to static HTML at build time; no client JavaScript.
import type { ReactNode } from 'react';
import type { ExampleNode } from '../lib/components';
import * as Lucide from 'lucide-react';
import { REGISTRY, resolveProps } from './registry';

/** Docs examples name icons by their Lucide name ("Trash2", "git-pull-request"). Build time only. */
function lucideIcon(name: string) {
  const pascal = name
    .split(/[-_\s]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
  const all = Lucide as unknown as Record<string, unknown>;
  const hit = all[name] ?? all[pascal] ?? all[`${pascal}Icon`];
  if (!hit) throw new Error(`docs-site: unknown Lucide icon "${name}" in a docs example`);
  return hit;
}

const isNode = (v: unknown): v is Exclude<ExampleNode, string> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && typeof (v as { c?: unknown }).c === 'string';

/** Example nodes inside props (a Badge in a Select option's `badge`) render as elements too. */
function resolveNested(value: unknown): unknown {
  if (isNode(value)) return render(value);
  if (Array.isArray(value)) return value.map(resolveNested);
  if (typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveNested(v)]));
  }
  return value;
}

function render(node: ExampleNode, key?: number): ReactNode {
  if (typeof node === 'string') return node;
  const Comp = REGISTRY[node.c];
  if (!Comp) throw new Error(`docs-site: unknown example component "${node.c}". Add it to registry.tsx.`);
  const children = node.children?.map((child, i) => render(child, i));
  const props = resolveNested(resolveProps(node.p, lucideIcon)) as Record<string, unknown>;
  return (
    <Comp key={key} {...props}>
      {children}
    </Comp>
  );
}

export default function Example({ node }: { node: ExampleNode }) {
  return <>{render(node)}</>;
}
