// Team pages (multi-team PR 3b): Studio Components of a team, read from its repository (scripts/team-data.ts). One
// sentence on the catalog, search and family on one row, then every component grouped by family. A row opens a
// drawer with ONE preview: the component's first story from the team's Storybook (bridge.config.json storybook.url,
// else the Storybook added in this browser), only in the open drawer. Without a Storybook, a band of token
// specimens (tokens only) and one line on how to add it. Mounted client:load; the server renders the skeleton.
// Repo content is React text only; links built from repo data go through lib/html.ts safeUrl.
import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Layers } from 'lucide-react';
import { Badge, Button, ButtonGroup, Drawer, DrawerContent, EmptyState, Input, Link, Select, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@bridge-ds/react';
import ButtonLink from '../ButtonLink';
import { GitHubMark } from './brand-icons';
import { TeamLoadError, TeamLoadProgress, TeamSourceNote, useTeamData } from './TeamState';
import TokenSpecimens from './TokenSpecimens';
import { filterTeamRows, pickStorybook, rowExceptions, storyPreview, teamComponentRows, teamComponentsLead, teamFamilies, type TeamComponentRow } from '../../../lib/team-components';
import { tokenSpecimens } from '../../../lib/token-specimens';
import { fileUrl } from '../../../lib/team-load';
import { safeUrl } from '../../../lib/html';
import { studioHref } from '../../../lib/team-path';
import { readWorkspace, onWorkspaceChange } from '../../../scripts/workspace';
import type { TeamData } from '../../../scripts/team-data';

const words = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

/** The Storybook added in this browser (quick start), read after mount: localStorage is not there on the server. */
function useBrowserStorybook(): string | undefined {
  const [url, setUrl] = useState<string | undefined>(undefined);
  useEffect(() => {
    setUrl(readWorkspace().storybook?.url);
    return onWorkspaceChange((w) => setUrl(w.storybook?.url));
  }, []);
  return url;
}

function ComponentDrawer({ row, data, storybook, onClose }: { row: TeamComponentRow | null; data: TeamData; storybook: string | undefined; onClose: () => void }) {
  const preview = row ? storyPreview(storybook, row) : null;
  const github = row ? safeUrl(fileUrl(data.owner, data.repo, data.sha, row.file)) : '';
  return (
    <Drawer open={Boolean(row)} onOpenChange={(open) => !open && onClose()}>
      {row && (
        <DrawerContent
          size="lg"
          title={row.name}
          description={row.summary}
          closeLabel="Close"
          footer={
            <ButtonGroup>
              {preview && (
                <ButtonLink variant="primary" href={preview.manager} iconEnd={ExternalLink} target="_blank" rel="noopener noreferrer">
                  Open in Storybook
                </ButtonLink>
              )}
              {github && (
                <ButtonLink variant={preview ? 'secondary' : 'primary'} href={github} iconStart={GitHubMark} target="_blank" rel="noopener noreferrer">
                  Open on GitHub
                </ButtonLink>
              )}
            </ButtonGroup>
          }
        >
          <div className="tcm-d">
            <p className="tcm-d-eyebrow">{row.family}</p>
            {preview ? (
              <figure className="tcm-d-frame">
                <iframe
                  key={preview.src}
                  src={preview.src}
                  title={`${row.name}, story ${preview.story}`}
                  sandbox="allow-scripts allow-same-origin allow-popups"
                  referrerPolicy="no-referrer"
                  loading="lazy"
                />
                <figcaption className="tcm-muted">Story {preview.story}, from the team's Storybook.</figcaption>
              </figure>
            ) : (
              <p className="tp-locked">
                {storybook ? `${row.name} has no story in the Storybook, so there is nothing to preview yet.` : 'Add your Storybook to preview this component here.'}
              </p>
            )}
            <p className="tcm-muted">
              {words(row.stories.length, 'story')} · {words(row.tokens, 'token')} · <span className="mono">{row.dir}</span>
            </p>
            {rowExceptions(row).length > 0 && (
              <p className="tcm-badges">
                {rowExceptions(row).map((b) => (
                  <Badge key={b.label} tone={b.tone} size="sm">
                    {b.label}
                  </Badge>
                ))}
              </p>
            )}
          </div>
        </DrawerContent>
      )}
    </Drawer>
  );
}

function Ready({ data, refreshing, onRefresh }: { data: TeamData; refreshing: boolean; onRefresh: () => void }) {
  const browserStorybook = useBrowserStorybook();
  const storybook = pickStorybook(data.storybook, browserStorybook);
  const rows = useMemo(() => teamComponentRows(data.model), [data.model]);
  const families = useMemo(() => teamFamilies(rows), [rows]);
  const specimens = useMemo(() => tokenSpecimens(data.model), [data.model]);
  const [query, setQuery] = useState('');
  const [family, setFamily] = useState('');
  const [open, setOpen] = useState<TeamComponentRow | null>(null);
  const shown = filterTeamRows(rows, query, family);
  const dir = data.model.components?.dir ?? data.model.config.components?.dir ?? 'components';

  const noStorybook = !storybook && (
    <div className="tp-locked">
      <p>
        <strong>Add your Storybook to see live components.</strong> Bridge shows tokens only until then.
      </p>
      <p>
        Set <span className="mono">storybook.url</span> in <span className="mono">bridge.config.json</span>, or{' '}
        <Link href={studioHref('components/storybook/')}>try it now with your Storybook address</Link>.
      </p>
    </div>
  );

  return (
    <div className="tcm">
      <TeamSourceNote data={data} refreshing={refreshing} onRefresh={onRefresh} />
      {rows.length === 0 ? (
        <>
          <EmptyState
            icon={Layers}
            headingLevel={2}
            align="start"
            title={`Bridge found no components in ${dir}`}
            description="Bridge reads one folder per component (Name.tsx, its stylesheet, stories and Name.docs.json). Point components.dir in bridge.config.json at the folder that holds them."
          />
          {noStorybook}
          <TokenSpecimens set={specimens} />
        </>
      ) : (
        <>
          <p className="tcm-lead">{teamComponentsLead(rows)}</p>
          {noStorybook}
          {!storybook && <TokenSpecimens set={specimens} />}
          <div className="tcm-tools" role="search">
            <Input label="Search components" hideLabel placeholder="Search by name or family" value={query} onValueChange={setQuery} className="tcm-search" />
            <Select
              label="Family"
              hideLabel
              value={family || ALL}
              onValueChange={(v) => setFamily(!v || v === ALL ? '' : v)}
              options={[{ value: ALL, label: `All families (${rows.length})` }, ...families.map((f) => ({ value: f.name, label: `${f.name} (${f.n})` }))]}
            />
          </div>
          <p className="tcm-muted" role="status" aria-live="polite">
            {shown.length === rows.length ? `Showing all ${words(rows.length, 'component')}.` : `Showing ${shown.length} of ${rows.length}.`}
          </p>
          {shown.length === 0 ? (
            <p className="tcm-muted">
              No component matches.{' '}
              <Button
                variant="link"
                onClick={() => {
                  setQuery('');
                  setFamily('');
                }}
              >
                Show every component
              </Button>
            </p>
          ) : (
            teamFamilies(shown).map((f) => (
              <section key={f.name} className="tcm-family" aria-label={f.name}>
                <h2 className="tcm-family-title">
                  {f.name} <span className="tcm-muted num">{f.n}</span>
                </h2>
                <Table aria-label={`${f.name} components`} narrowLayout="stack" layout="fixed">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Component</TableHead>
                      <TableHead numeric width={0.12}>
                        Stories
                      </TableHead>
                      <TableHead numeric width={0.12}>
                        Tokens
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shown
                      .filter((r) => r.family === f.name)
                      .map((r) => (
                        <TableRow key={r.slug}>
                          <TableCell>
                            <span className="tcm-name">
                              <Button variant="link" onClick={() => setOpen(r)} className="tcm-open">
                                {r.name}
                              </Button>
                              {rowExceptions(r).map((b) => (
                                <Badge key={b.label} tone={b.tone} size="sm">
                                  {b.label}
                                </Badge>
                              ))}
                            </span>
                            {r.summary && <span className="tcm-summary">{r.summary}</span>}
                          </TableCell>
                          <TableCell numeric>{r.stories.length}</TableCell>
                          <TableCell numeric>{r.tokens}</TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </section>
            ))
          )}
        </>
      )}
      <ComponentDrawer row={open} data={data} storybook={storybook} onClose={() => setOpen(null)} />
    </div>
  );
}

/** The family menu's "every family" choice (an empty value reads as no choice in the DS Select). */
const ALL = '__all__';

export default function TeamComponents() {
  const { load, retry } = useTeamData();
  if (load.status === 'loading') return <TeamLoadProgress label="Reading the components" />;
  if (load.status === 'error') return <TeamLoadError failure={load.failure} onRetry={retry} />;
  return <Ready data={load.data} refreshing={load.refreshing} onRefresh={retry} />;
}
