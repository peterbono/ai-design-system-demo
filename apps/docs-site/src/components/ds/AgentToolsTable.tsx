// The MCP tools table of the Agents page, built with DS Table parts inside React: Astro wraps React children in
// <astro-static-slot>, which the HTML parser foster-parents out of a <table>, so the parts cannot nest in .astro.
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@bridge-ds/react';

export interface AgentTool {
  name: string;
  /** Inline HTML rendered at build time from the repo's AI doc (trusted source). */
  use: string;
}

export default function AgentToolsTable({ tools }: { tools: AgentTool[] }) {
  return (
    <Table aria-label={`${tools.length} MCP tools`}>
      <TableHeader>
        <TableRow>
          <TableHead>Tool</TableHead>
          <TableHead>Use it to</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tools.map((t) => (
          <TableRow key={t.name}>
            <TableHead scope="row">
              <code>{t.name}</code>
            </TableHead>
            <TableCell dangerouslySetInnerHTML={{ __html: t.use }} />
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
