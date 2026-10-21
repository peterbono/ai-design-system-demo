// Studio Components, Storybook quick start (plan section 5; page pages/studio/components/storybook.astro). Reads the
// Storybook added in this browser (scripts/workspace.ts) through scripts/storybook-source.ts and shows, from its index
// only: one sentence on what was found, the components by family (search and the family menu filter them), and a
// drawer per component with a live preview of one story at a time. Preview through iframe.html when the host allows
// framing; otherwise the drawer says so and links out. What needs the repository (tokens, contrast checks,
// suggestions) is said once on the page and once in the drawer, calmly, with the way to connect it.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ExternalLink, Lock, RefreshCw, Search } from 'lucide-react';
import { storybookIframeUrl, storybookManagerUrl, type StorybookComponent } from '@bridge-ds/core';
import {
  Alert,
  Button,
  Drawer,
  DrawerContent,
  EmptyState,
  Icon,
  Input,
  Link,
  Select,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tag,
} from '@bridge-ds/react';
import ButtonLink from '../ButtonLink';
import { Drawing } from './Drawing';
import { StorybookField, toWorkspace } from './StorybookField';
import { loadStorybook, StorybookLoadError, type LoadedStorybook } from '../../../scripts/storybook-source';
import { onWorkspaceChange, readWorkspace, saveStorybook } from '../../../scripts/workspace';
import {
  checkedAgo,
  CONNECT_REPO,
  filterStorybookRows,
  frameLine,
  LOCKED_LINE,
  rowFacts,
  shownTags,
  storybookErrorLine,
  storybookFamilies,
  storybookLead,
  storybookRows,
  TOP_LEVEL,
  type FrameVerdict,
  type StorybookRow,
} from '../../../lib/storybook-view';
import { storybookHost, type Workspace } from '../../../lib/workspace';

type Load = { state: 'idle' } | { state: 'loading' } | { state: 'ready'; sb: LoadedStorybook } | { state: 'error'; code: string };

/** One calm line for what quick start cannot do, with the way to connect the repository. */
export function LockedLine({ className }: { className?: string }) {
  return (
    <p className={`sbq-locked${className ? ` ${className}` : ''}`}>
      <Icon icon={Lock} size="sm" />
      <span>
        {LOCKED_LINE} <Link href={CONNECT_REPO.href}>{CONNECT_REPO.label}</Link>
      </span>
    </p>
  );
}

type PreviewEntry = { id: string; label: string; mode: 'story' | 'docs' };

/** The stories, then the docs pages, of one component: what the preview can show. */
function previewEntries(component: StorybookComponent): PreviewEntry[] {
  return [
    ...component.stories.map((s) => ({ id: s.id, label: s.name, mode: 'story' as const })),
    ...component.docs.map((d) => ({ id: d.id, label: d.name === 'Docs' ? 'Docs page' : `${d.name} (docs)`, mode: 'docs' as const })),
  ];
}

function Preview({ base, component, entries, entry, onPick, frame }: { base: string; component: StorybookComponent; entries: PreviewEntry[]; entry: PreviewEntry; onPick: (id: string) => void; frame: FrameVerdict }) {
  const blocked = frameLine(frame);
  return (
    <div className="sbq-preview">
      {entries.length > 1 && (
        <Select
          label={component.docs.length ? 'Story or docs' : 'Story'}
          size="md"
          value={entry.id}
          onValueChange={(v) => v && onPick(v)}
          options={entries.map((e) => ({ value: e.id, label: e.label, group: e.mode === 'docs' ? 'Docs' : 'Stories' }))}
        />
      )}
      {blocked ? (
        <div className="sbq-frame sbq-frame-blocked">
          <p>{blocked}</p>
        </div>
      ) : (
        <>
          <iframe
            key={entry.id}
            className="sbq-frame"
            src={storybookIframeUrl(base, entry.id, { viewMode: entry.mode })}
            title={`${component.name}, ${entry.label}, from your Storybook`}
            loading="lazy"
            referrerPolicy="no-referrer"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
          {frame === 'unknown' && <p className="sbq-quiet">If the preview stays blank, this Storybook does not allow showing its stories on other sites. Open it in Storybook.</p>}
        </>
      )}
    </div>
  );
}

function ComponentDrawer({ sb, component, onClose }: { sb: LoadedStorybook; component: StorybookComponent | null; onClose: () => void }) {
  const entries = component ? previewEntries(component) : [];
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => setPicked(null), [component?.title]);
  const entry = entries.find((e) => e.id === picked) ?? entries[0];
  const tags = component ? shownTags(component) : [];
  return (
    <Drawer open={Boolean(component)} onOpenChange={(o) => !o && onClose()}>
      {component && (
        <DrawerContent
          size="lg"
          title={component.name}
          description={component.group.length ? component.group.join(' / ') : undefined}
          footer={
            entry && (
              <ButtonLink variant="primary" href={storybookManagerUrl(sb.base, entry.id, entry.mode)} target="_blank" rel="noopener noreferrer" iconEnd={ExternalLink}>
                Open in Storybook
              </ButtonLink>
            )
          }
        >
          <div className="sbq-drawer">
            <p className="sbq-quiet">{rowFacts({ stories: component.stories.length, docs: component.docs.length > 0 })}, from your Storybook.</p>
            {entry && <Preview base={sb.base} component={component} entries={entries} entry={entry} onPick={setPicked} frame={sb.frame} />}
            {tags.length > 0 && (
              <p className="sbq-tags" aria-label="Tags">
                {tags.map((t) => (
                  <Tag key={t} size="sm">
                    {t}
                  </Tag>
                ))}
              </p>
            )}
            <LockedLine />
          </div>
        </DrawerContent>
      )}
    </Drawer>
  );
}

function List({ rows, onOpen }: { rows: StorybookRow[]; onOpen: (title: string) => void }) {
  const families = [...new Set(rows.map((r) => r.family || TOP_LEVEL))];
  return (
    <Table aria-label="Components from your Storybook, by family" className="cm-table sbq-table">
      <TableHeader>
        <TableRow>
          <TableHead>Component</TableHead>
          <TableHead className="cm-col-dev">Examples</TableHead>
        </TableRow>
      </TableHeader>
      {families.map((family) => (
        <TableBody key={family}>
          <TableRow className="cm-fam">
            <TableHead scope="rowgroup" colSpan={2}>
              {family}
            </TableHead>
          </TableRow>
          {rows
            .filter((r) => (r.family || TOP_LEVEL) === family)
            .map((r) => (
              <TableRow key={r.title} className="cm-row" onClick={() => onOpen(r.title)}>
                <TableCell role="rowheader" className="cm-name">
                  <Button variant="link" className="sbq-open" onClick={(e) => (e.stopPropagation(), onOpen(r.title))} aria-haspopup="dialog">
                    {r.name}
                  </Button>
                </TableCell>
                <TableCell className="cm-col-dev cm-muted">{rowFacts(r)}</TableCell>
              </TableRow>
            ))}
        </TableBody>
      ))}
    </Table>
  );
}

export interface StorybookComponentsProps {
  /** This library's own Storybook (bridge.config.json), offered when nothing is added yet. */
  suggestion: string | null;
}

export default function StorybookComponents({ suggestion }: StorybookComponentsProps) {
  const [ws, setWs] = useState<Workspace>(() => (typeof window === 'undefined' ? { storybook: null } : readWorkspace()));
  const [load, setLoad] = useState<Load>({ state: 'idle' });
  const [query, setQuery] = useState('');
  const [family, setFamily] = useState('all');
  const [open, setOpen] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [prefill, setPrefill] = useState('');
  const [changing, setChanging] = useState(false);
  const url = ws.storybook?.url ?? null;

  useEffect(() => onWorkspaceChange(setWs), []);

  useEffect(() => {
    if (!url) {
      setLoad({ state: 'idle' });
      return;
    }
    const ctl = new AbortController();
    setLoad({ state: 'loading' });
    loadStorybook(url, { signal: ctl.signal, fresh: attempt > 0 })
      .then((sb) => {
        if (ctl.signal.aborted) return;
        setLoad({ state: 'ready', sb });
        // Keep the counts on the onboarding step in step with what the Storybook holds today.
        const fresh = toWorkspace(sb);
        if (fresh.components !== ws.storybook?.components || fresh.stories !== ws.storybook?.stories) saveStorybook(fresh);
      })
      .catch((err) => {
        if (ctl.signal.aborted) return;
        setLoad({ state: 'error', code: err instanceof StorybookLoadError ? err.code : 'network' });
      });
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, attempt]);

  const rows = useMemo(() => (load.state === 'ready' ? storybookRows(load.sb.index) : []), [load]);
  const families = useMemo(() => storybookFamilies(rows), [rows]);
  const shown = filterStorybookRows(rows, query, family === 'all' ? '' : family);
  const component = load.state === 'ready' && open ? (load.sb.index.components.find((c) => c.title === open) ?? null) : null;
  const host = url ? storybookHost(url) : null;

  const head = (lead: ReactNode, actions?: ReactNode) => (
    <header className="st-head">
      <div className="st-head-main">
        <div className="st-title-row">
          <h1 className="st-title">Components</h1>
        </div>
        <p className="cm-lead">{lead}</p>
        {host && (
          <p className="sbq-source">
            From <span className="mono">{host}</span>
            {ws.storybook && <span> · {checkedAgo(ws.storybook.checkedAt, Date.now())}</span>}
            {!changing && (
              <>
                {' · '}
                <Button variant="link" onClick={() => setChanging(true)}>
                  Change
                </Button>
              </>
            )}
          </p>
        )}
        {changing && (
          <div className="sbq-change">
            <StorybookField saved={ws.storybook} seeLink={false} id="sbq-change-url" onCancel={() => setChanging(false)} />
          </div>
        )}
      </div>
      {actions && <div className="st-head-actions">{actions}</div>}
    </header>
  );

  if (!url) {
    return (
      <div className="cm sbq">
        {head('See the components of any published Storybook, without the repository.')}
        <section className="sbq-start" aria-labelledby="sbq-start-title">
          <Drawing name="components" width={104} className="sbq-art" />
          <div className="sbq-start-body">
            <h2 id="sbq-start-title" className="sbq-h2">
              Paste your Storybook URL
            </h2>
            <p className="sbq-quiet">Bridge reads the list of stories your Storybook publishes, nothing else.</p>
            <StorybookField key={prefill} initial={prefill} saved={null} seeLink={false} id="sbq-url" />
            {suggestion && !prefill && (
              <p className="sbq-quiet">
                No Storybook at hand? This library publishes one:{' '}
                <Button variant="link" onClick={() => setPrefill(suggestion)}>
                  use {storybookHost(suggestion)}
                </Button>
              </p>
            )}
          </div>
        </section>
      </div>
    );
  }

  if (load.state === 'error') {
    return (
      <div className="cm sbq">
        {head('Your components show here once Bridge can read your Storybook again.')}
        <Alert
          tone="warning"
          title="Bridge could not read your Storybook"
          actions={
            <Button variant="secondary" iconStart={RefreshCw} onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </Button>
          }
        >
          {storybookErrorLine(load.code)}
        </Alert>
      </div>
    );
  }

  if (load.state !== 'ready') {
    return (
      <div className="cm sbq" aria-busy="true">
        {head(<Skeleton variant="text" width="28ch" />)}
        <Skeleton variant="rect" height="var(--size-80)" />
      </div>
    );
  }

  const sb = load.sb;
  return (
    <div className="cm sbq">
      {head(
        storybookLead(sb.index),
        <ButtonLink variant="secondary" href={`${sb.base}/`} target="_blank" rel="noopener noreferrer" iconEnd={ExternalLink}>
          Open Storybook
        </ButtonLink>,
      )}
      <LockedLine className="sbq-locked-page" />
      <div className="cm-tools" role="search">
        <Input className="cm-search" size="md" type="search" placeholder="Filter components" aria-label="Filter components" prefix={<Icon icon={Search} size="sm" />} autoComplete="off" value={query} onValueChange={setQuery} />
        {families.length > 1 && (
          <Select
            label="Family"
            hideLabel
            size="md"
            value={family}
            onValueChange={(v) => setFamily(v ?? 'all')}
            options={[{ value: 'all', label: `All families (${rows.length})` }, ...families.map((f) => ({ value: f.name, label: `${f.name} (${f.n})` }))]}
          />
        )}
      </div>
      <p className="cm-count" role="status" aria-live="polite">
        {query || family !== 'all' ? `${shown.length} of ${rows.length} components` : ''}
      </p>
      {shown.length ? (
        <List rows={shown} onOpen={setOpen} />
      ) : (
        <EmptyState
          size="sm"
          title="No component matches"
          actions={
            <Button
              variant="secondary"
              onClick={() => {
                setQuery('');
                setFamily('all');
              }}
            >
              Show every component
            </Button>
          }
        />
      )}
      <ComponentDrawer sb={sb} component={component} onClose={() => setOpen(null)} />
    </div>
  );
}
