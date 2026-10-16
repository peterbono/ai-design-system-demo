// One registry of renderable components, shared by the static examples (Example.tsx) and the props playground
// island. Adding a component to the docs means adding one line here.
import type { ComponentType, CSSProperties, ReactNode } from 'react';
import { Badge, Button, Card, CardBody, CardFooter, CardHeader, Input } from '@demo-ds/react';

const layout = (style: CSSProperties) =>
  function Layout({ children }: { children?: ReactNode }) {
    return <div style={style}>{children}</div>;
  };

export const REGISTRY: Record<string, ComponentType<any>> = {
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
