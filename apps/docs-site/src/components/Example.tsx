// Renders the declarative examples from <Name>.docs.json with the real components from @demo-ds/react.
// Rendered to static HTML at build time; no client JavaScript.
import type { ComponentType, CSSProperties, ReactNode } from 'react';
import { Badge, Button, Card, CardBody, CardFooter, CardHeader, Input } from '@demo-ds/react';
import type { ExampleNode } from '../lib/components';

const layout = (style: CSSProperties) =>
  function Layout({ children }: { children?: ReactNode }) {
    return <div style={style}>{children}</div>;
  };

const REGISTRY: Record<string, ComponentType<any>> = {
  Button,
  Input,
  Badge,
  Card,
  CardHeader,
  CardBody,
  CardFooter,
  Row: layout({ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)', alignItems: 'center' }),
  Stack: layout({ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', maxWidth: '22rem', width: '100%' }),
  Box: layout({ maxWidth: '26rem', width: '100%' }),
};

function render(node: ExampleNode, key?: number): ReactNode {
  if (typeof node === 'string') return node;
  const Comp = REGISTRY[node.c];
  if (!Comp) throw new Error(`docs-site: unknown example component "${node.c}". Add it to Example.tsx.`);
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
