// Studio Components: every component with its status, guidance, counts and links, as a DS Table.
// Row headers keep their semantics through role="rowheader" (the DS Table has no row-header cell yet).
import { Badge, Icon, Link, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, type BadgeTone } from '@bridge-ds/react';
import { Pencil } from 'lucide-react';
import { GitHubMark, StorybookMark } from './brand-icons';

export interface ComponentRow {
  slug: string;
  name: string;
  status: string;
  category: string;
  documented: boolean;
  tokens: number;
  props: number;
  stories: number;
  /** Studio Tokens filtered on this component's tokens; absent when it reads no token. */
  editHref?: string;
  codeHref: string;
  storyHref?: string;
}

const TONE: Record<string, BadgeTone> = { stable: 'success', beta: 'info' };
const label = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export default function ComponentsTable({ rows }: { rows: ComponentRow[] }) {
  return (
    <Table aria-label="Components, their status and links">
      <TableHeader>
        <TableRow>
          <TableHead>Component</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Family</TableHead>
          <TableHead>Guidance</TableHead>
          <TableHead numeric>Tokens</TableHead>
          <TableHead numeric>Props</TableHead>
          <TableHead numeric>Stories</TableHead>
          <TableHead>Links</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((c) => (
          <TableRow key={c.slug} id={`c-${c.slug}`} data-slug={c.slug}>
            <TableCell role="rowheader">
              <Link variant="standalone" href={`/components/${c.slug}/`}>
                {c.name}
              </Link>
            </TableCell>
            <TableCell>
              <Badge size="sm" tone={TONE[c.status] ?? 'warning'}>
                {label(c.status)}
              </Badge>
            </TableCell>
            <TableCell>{c.category}</TableCell>
            <TableCell>
              {c.documented ? (
                'Yes'
              ) : (
                <Badge size="sm" tone="warning">
                  Missing
                </Badge>
              )}
            </TableCell>
            <TableCell numeric>{c.tokens}</TableCell>
            <TableCell numeric>{c.props}</TableCell>
            <TableCell numeric>{c.stories}</TableCell>
            <TableCell>
              <span className="st-links">
                {c.editHref && (
                  <Link variant="standalone" href={c.editHref} data-keep-branch="">
                    <Icon icon={Pencil} size="xs" />
                    Edit tokens
                  </Link>
                )}
                <Link variant="standalone" href={c.codeHref}>
                  <Icon icon={GitHubMark} size="xs" />
                  Code
                </Link>
                {c.storyHref && (
                  <Link variant="standalone" href={c.storyHref}>
                    <Icon icon={StorybookMark} size="xs" />
                    Workbench
                  </Link>
                )}
              </span>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
