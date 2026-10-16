// Renders the declarative examples from <Name>.docs.json with the real components from @demo-ds/react.
// Rendered to static HTML at build time; no client JavaScript.
import type { ReactNode } from 'react';
import type { ExampleNode } from '../lib/components';
import { REGISTRY } from './registry';

function render(node: ExampleNode, key?: number): ReactNode {
  if (typeof node === 'string') return node;
  const Comp = REGISTRY[node.c];
  if (!Comp) throw new Error(`docs-site: unknown example component "${node.c}". Add it to registry.tsx.`);
  const children = node.children?.map((child, i) => render(child, i));
  return (
    <Comp key={key} {...(node.p ?? {})}>
      {children}
    </Comp>
  );
}

export default function Example({ node }: { node: ExampleNode }) {
  return <>{render(node)}</>;
}
