// Team pages (multi-team PR 3b): Studio Components of a team, read from its repository (scripts/team-data.ts). One
// sentence on the catalog, search and family on one row, then every component grouped by family in the same catalog
// as the self-hosted Studio (ComponentsList: a thumbnail of the docs.json preview, the products that use it from the
// team's adoption reports, examples, tokens and Figma coverage), all from the snapshot for a guest. A row opens a
// drawer with ONE preview: the component's first story from the team's Storybook (bridge.config.json storybook.url,
// else the Storybook added in this browser), only in the open drawer. Without a Storybook, a band of token
// specimens (tokens only) and one line on how to add it. Mounted client:load; the server renders the skeleton.
// Repo content is React text only; links built from repo data go through lib/html.ts safeUrl.
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { Ellipsis, ExternalLink, Layers } from 'lucide-react';
import { Badge, Button, ButtonGroup, CodeBlock, Drawer, DrawerContent, EmptyState, IconButton, Input, Link, Menu, MenuContent, MenuItem, MenuTrigger, Select, Tooltip } from '@bridge-ds/react';
import ButtonLink from '../ButtonLink';
import { TeamLoadError, TeamLoadProgress, TeamSourceNote, useTeamData } from './TeamState';
import TokenSpecimens from './TokenSpecimens';
import ComponentsList from './ComponentsList';
import ClientExample from './ClientExample';
import { ChangeFooter, ChangeStep, CLOSED_FLOW, type ChangeFlow } from './ChangeComponent';
import { isChangeIntent, PICK_COMPONENT_LINE, type ChangeIntent } from '../../../lib/change-intent';
import { filterTeamRows, pickStorybook, rowExceptions, storyPreview, teamCatalogRows, teamComponentRows, teamComponentsLead, teamFamilies, type TeamComponentRow } from '../../../lib/team-components';
import type { ProductAudit } from '../../../lib/components-studio';
import { fitFrames } from '../../../scripts/explorer/preview-frames';
import { exampleCode, storyInIndex } from '../../../lib/library/component-page';
import { tokenSpecimens } from '../../../lib/token-specimens';
import { postedStoryHeight } from '../../../lib/story-frame';
import { fileUrl } from '../../../lib/team-load';
import { safeUrl } from '../../../lib/html';
import { studioHref } from '../../../lib/team-path';
import { libraryHref } from '../../../lib/library-shells';
import { readWorkspace, onWorkspaceChange } from '../../../scripts/workspace';
import { loadTeamProductUsage, type TeamData } from '../../../scripts/team-data';

const words = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

/** The list thumbnails' largest scale, as on the self-hosted page (scripts/components-studio.ts THUMB_MAX). */
const THUMB_MAX = 0.7;

/** The products that use each component (the team's adoption reports), null until read or without any. */
function useProductUsage(data: TeamData): ProductAudit[] | null {
  const [audits, setAudits] = useState<ProductAudit[] | null>(null);
  useEffect(() => {
    let live = true;
    void loadTeamProductUsage().then((a) => live && setAudits(a));
    return () => {
      live = false;
    };
  }, [data]);
  return audits;
}

/** The Storybook added in this browser (quick start), read after mount: localStorage is not there on the server. */
function useBrowserStorybook(): string | undefined {
  const [url, setUrl] = useState<string | undefined>(undefined);
  useEffect(() => {
    setUrl(readWorkspace().storybook?.url);
    return onWorkspaceChange((w) => setUrl(w.storybook?.url));
  }, []);
  return url;
}

/**
 * Whether the published Storybook lists a story: 'listed', 'missing' (the code is ahead of the last Storybook build),
 * 'unknown' (the index could not be read: the frame shows what it can), undefined while reading.
 */
function useStoryListed(base: string | undefined, id: string | undefined): 'listed' | 'missing' | 'unknown' | undefined {
  const [state, setState] = useState<{ key: string; value: 'listed' | 'missing' | 'unknown' } | null>(null);
  const key = `${base ?? ''}|${id ?? ''}`;
  useEffect(() => {
    if (!base || !id) return;
    let live = true;
    void import('../../../scripts/storybook-source')
      .then(({ loadStorybook }) => loadStorybook(base))
      .then(({ index }) => (storyInIndex(index.entries, id) ? 'listed' : 'missing'))
      .catch(() => 'unknown' as const)
      .then((value) => live && setState({ key, value }));
    return () => {
      live = false;
    };
  }, [base, id, key]);
  return state?.key === key ? state.value : undefined;
}

/**
 * The height a story embedded in `frame` posts (lib/story-frame.ts), or null until it does: a Storybook that never
 * posts keeps the frame's resting height. Only messages from that frame's own window count.
 */
function useStoryHeight(frame: RefObject<HTMLIFrameElement | null>, src: string | undefined): number | null {
  const [state, setState] = useState<{ src: string; height: number } | null>(null);
  useEffect(() => {
    if (!src) return;
    const onMessage = (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      const height = postedStoryHeight(e.data);
      if (height !== null) setState({ src, height });
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [frame, src]);
  return state && state.src === src ? state.height : null;
}

function ComponentDrawer({ row, data, storybook, startIntent = null, onClose }: { row: TeamComponentRow | null; data: TeamData; storybook: string | undefined; startIntent?: ChangeIntent | null; onClose: () => void }) {
  const found = row ? storyPreview(storybook, row) : null;
  const listed = useStoryListed(found?.base, found?.id);
  // A story the published Storybook does not have yet would show Storybook's own error: the code instead.
  const preview = listed === 'missing' ? null : found;
  const frameRef = useRef<HTMLIFrameElement>(null);
  const storyHeight = useStoryHeight(frameRef, preview?.src);
  const github = row ? safeUrl(fileUrl(data.owner, data.repo, data.sha, row.file)) : '';
  // Change this component: the step's state, shared by the body (the question and the form) and the footer (its one
  // primary action). A new component starts closed.
  const [flow, setFlow] = useState<ChangeFlow>(CLOSED_FLOW);
  const formId = useId();
  // A deep link (the home's "Ask for a component change", ?c=<slug>&intent=...) opens the step on that choice;
  // "Adjust the look" stays unpicked on a component with no token.
  useEffect(() => {
    const tokens = (row?.tokens ?? 0) > 0;
    setFlow(row && startIntent ? { ...CLOSED_FLOW, open: true, intent: startIntent === 'look' && !tokens ? null : startIntent } : CLOSED_FLOW);
  }, [row, startIntent]);
  const repo = `${data.owner}/${data.repo}`;
  const hasTokens = (row?.tokens ?? 0) > 0;
  const more = github && (
    // The source file is for developers: it waits in More.
    <Menu>
      <Tooltip content="More actions">
        <MenuTrigger render={<IconButton icon={Ellipsis} label="More actions" variant="secondary" />} />
      </Tooltip>
      <MenuContent side="top" align="end">
        <MenuItem onClick={() => window.open(github, '_blank', 'noopener,noreferrer')}>Open the code on GitHub</MenuItem>
      </MenuContent>
    </Menu>
  );
  return (
    <Drawer open={Boolean(row)} onOpenChange={(open) => !open && onClose()}>
      {row && (
        <DrawerContent
          size="lg"
          title={row.name}
          description={row.summary}
          closeLabel="Close"
          footer={
            row && (
              <ButtonGroup>
                <ChangeFooter
                  component={row.name}
                  slug={row.slug}
                  hasTokens={hasTokens}
                  flow={flow}
                  setFlow={setFlow}
                  formId={formId}
                  rest={
                    <>
                      {preview && (
                        <ButtonLink variant="secondary" href={preview.manager} iconEnd={ExternalLink} target="_blank" rel="noopener noreferrer">
                          Open in Storybook
                        </ButtonLink>
                      )}
                      {more}
                    </>
                  }
                />
              </ButtonGroup>
            )
          }
        >
          <div className="tcm-d">
            <p className="tcm-d-eyebrow">{row.family}</p>
            {found && listed === 'missing' ? (
              <div className="tcm-d-missing">
                <p className="tcm-muted">Preview appears after the next Storybook update.</p>
                <CodeBlock code={exampleCode(row.name, null)} label={`${row.name} example`} />
              </div>
            ) : found && listed === undefined ? (
              <p className="tcm-muted">Loading the preview.</p>
            ) : preview ? (
              <figure className="tcm-d-frame">
                <iframe
                  key={preview.src}
                  ref={frameRef}
                  src={preview.src}
                  // The story's posted height; the CSS keeps it between the resting min and the max.
                  style={storyHeight ? ({ '--tcm-story-h': `${storyHeight}px` } as CSSProperties) : undefined}
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
              {/* The list's words ("12 examples"); the folder is a developer's, behind More > Open the code on GitHub. */}
              {words(row.stories.length, 'example')} · {words(row.tokens, 'token')}
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
            <ChangeStep
              component={row.name}
              slug={row.slug}
              hasTokens={hasTokens}
              repo={repo}
              integrations={data.model.site.integrations}
              componentUrl={new URL(libraryHref(data.owner, data.repo, `components/${row.slug}/`), location.origin).href}
              flow={flow}
              setFlow={setFlow}
              formId={formId}
            />
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
  // From a home's "Ask for a component change" (?intent=, and ?c=<slug> when it names one): the drawer opens on that
  // component with the step on that choice; without a component, one line says to pick one. Read once, then the
  // intent leaves the address so a reload or another row starts plain.
  const [deep, setDeep] = useState<{ intent: ChangeIntent | null; pick: boolean }>({ intent: null, pick: false });
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const intent = params.get('intent');
    const slug = params.get('c');
    const row = slug ? rows.find((r) => r.slug === slug.toLowerCase()) : undefined;
    if (row) setOpen(row);
    if (isChangeIntent(intent)) {
      setDeep({ intent: row ? intent : null, pick: !row });
      params.delete('intent');
      const q = params.toString();
      history.replaceState(null, '', `${location.pathname}${q ? `?${q}` : ''}${location.hash}`);
    }
    // Once, with the rows of this read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const shown = useMemo(() => filterTeamRows(rows, query, family), [rows, query, family]);
  const audits = useProductUsage(data);
  const catalog = useMemo(() => teamCatalogRows(data.model, shown, audits), [data.model, shown, audits]);
  const listRef = useRef<HTMLDivElement>(null);
  // Thumbnails scale to fit their frame once drawn, and again when the list or the window changes.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const fit = () => fitFrames(el, { max: THUMB_MAX });
    const raf = requestAnimationFrame(fit);
    void document.fonts?.ready.then(fit);
    window.addEventListener('resize', fit);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', fit);
    };
  }, [catalog]);
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
          {deep.pick && (
            <p className="tcm-pick" role="status">
              {PICK_COMPONENT_LINE}
            </p>
          )}
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
            <div ref={listRef}>
              <ComponentsList rows={catalog} products={audits?.length ?? 0} Thumb={ClientExample} onOpen={(slug) => {
                  setDeep({ intent: null, pick: false });
                  setOpen(rows.find((r) => r.slug === slug) ?? null);
                }} openSlug={open?.slug ?? null} />
            </div>
          )}
        </>
      )}
      <ComponentDrawer
        row={open}
        data={data}
        storybook={storybook}
        startIntent={deep.intent}
        onClose={() => {
          setDeep({ intent: null, pick: false });
          setOpen(null);
        }}
      />
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
