// A docs.json example drawn in the browser, for a team's Studio (the self-hosted pages draw them at build time with
// components/Example.tsx). Same registry and prop sanitizing (components/registry.tsx), the small icon set only so the
// client bundle does not carry every Lucide icon. A component the registry does not know draws nothing, and a sample
// that throws leaves an empty frame instead of taking the page down: the example comes from the team's repository.
import { Component, type ReactNode } from 'react';
import type { ExampleNode } from '@bridge-ds/core';
import { REGISTRY, resolveProps } from '../../registry';

function render(node: ExampleNode, key?: number): ReactNode {
  if (typeof node === 'string') return node;
  const Comp = REGISTRY[node.c];
  if (!Comp) return null;
  return (
    <Comp key={key} {...resolveProps(node.p)}>
      {node.children?.map((child, i) => render(child, i))}
    </Comp>
  );
}

class Contained extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

export default function ClientExample({ node }: { node: ExampleNode }) {
  return <Contained>{render(node)}</Contained>;
}
