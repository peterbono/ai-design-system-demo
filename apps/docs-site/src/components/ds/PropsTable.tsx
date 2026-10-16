// The Props table of a component page, rendered entirely in React with the DS Table parts. Astro wraps the
// children of a React component in an <astro-static-slot> element, which is not allowed inside <table>, so table
// parts cannot be nested from an .astro file: build the whole table here from data instead. Static, no client JS.
import { Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@bridge-ds/react';

export interface PropRow {
  name: string;
  type: string;
  required?: boolean;
  defaultValue?: string | null;
  description?: string | null;
}

export default function PropsTable({ component, rows }: { component: string; rows: PropRow[] }) {
  return (
    <Table aria-label={`${component} props`} className="props-table">
      <TableHeader>
        <TableRow>
          <TableHead>Prop</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Default</TableHead>
          <TableHead>Description</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((p) => (
          <TableRow key={p.name}>
            <TableHead scope="row">
              <code className="prop-name">{p.name}</code>
              {p.required && (
                <Badge tone="info" size="sm" className="lib-prop-required">
                  required
                </Badge>
              )}
            </TableHead>
            <TableCell>
              <code className="prop-type">{p.type}</code>
            </TableCell>
            <TableCell>{p.defaultValue ? <code>{p.defaultValue}</code> : <span className="muted">none</span>}</TableCell>
            <TableCell>{p.description ?? <span className="muted">No description in the code yet.</span>}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
