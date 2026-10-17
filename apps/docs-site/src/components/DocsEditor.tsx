// Studio docs editor: a component's docs.json as a structured form, with the real Library Usage tab rendered live
// beside it. A hydrated island (client:load). Every change lands in the local draft (bridge.draft.v1, an edit of
// kind "docs"); "Propose change" opens a Tier 1 pull request. Opened from a pull request (?pr=N&ref=branch), it
// edits that branch's file and commits to it instead.
import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, IconButton, Input, Textarea } from '@bridge-ds/react';
import { Plus, Trash2 } from 'lucide-react';
import type { ComponentDocsJson, DocsGuidance } from '@bridge-ds/core';
import UsagePanel from './UsagePanel';
import { REGISTRY, resolveProps } from './registry';
import type { ExampleNode } from '../lib/components';
import { cleanDocs, docsEdits, docsFileText, docsText, setDocsEdit, validateDocs } from '../lib/docs-draft-model';
import type { Draft } from '../lib/editor-model';

export interface DocsEditorProps {
  name: string;
  slug: string;
  /** Repo path of the docs.json. */
  path: string;
  /** The docs.json on main, as text, or null when the component has none. */
  original: string | null;
  /** Where the form starts: the docs on main, or the deterministic pre-fill when there are none. */
  initial: ComponentDocsJson;
  facts: { propsTable: string; tokens: string; contrastNotes: string[]; changelogLine: string; missing: string[] };
  repo: { owner: string; repo: string };
}

const DRAFT_KEY = 'bridge.draft.v1';

function readDraft(): Draft {
  try {
    return (JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null') as Draft | null) ?? { edits: [] };
  } catch {
    return { edits: [] };
  }
}

function writeDraft(d: Draft) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
  } catch {
    /* private mode: the draft lives for this page */
  }
  document.dispatchEvent(new CustomEvent('bridge:draft'));
}

/** Docs examples on the client: registered components, the small icon set; a broken example says so. */
class Guard extends Component<{ children: ReactNode; k: string }, { failed: boolean; k: string }> {
  state = { failed: false, k: this.props.k };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  static getDerivedStateFromProps(p: { k: string }, s: { failed: boolean; k: string }) {
    return p.k !== s.k ? { failed: false, k: p.k } : null;
  }
  render() {
    return this.state.failed ? <p className="de-note">This example does not render. Check the component names and props.</p> : this.props.children;
  }
}

function renderNode(node: ExampleNode, key?: number): ReactNode {
  if (typeof node === 'string') return node;
  const Comp = REGISTRY[node.c];
  if (!Comp) throw new Error(`Unknown component ${node.c}`);
  return (
    <Comp key={key} {...resolveProps(node.p)}>
      {node.children?.map((c, i) => renderNode(c, i))}
    </Comp>
  );
}

function ClientExample({ node }: { node: ExampleNode }) {
  return <Guard k={JSON.stringify(node)}>{renderNode(node)}</Guard>;
}

type ListKey = 'whenToUse' | 'whenNotToUse' | 'accessibility' | 'contentGuidelines';
type GuideKey = 'dos' | 'donts';

function Section({ id, title, count, open, children }: { id: string; title: string; count?: number; open?: boolean; children: ReactNode }) {
  return (
    <details className="de-sec" id={id} open={open}>
      <summary className="de-sec-head">
        <span className="de-sec-title">{title}</span>
        {count !== undefined && <span className="de-sec-n num">{count}</span>}
        <span className="de-sec-chev" aria-hidden="true" />
      </summary>
      <div className="de-sec-body">{children}</div>
    </details>
  );
}

export default function DocsEditor(p: DocsEditorProps) {
  const params = typeof location === 'undefined' ? new URLSearchParams() : new URLSearchParams(location.search);
  const prRef = params.get('ref');
  const prNumber = Number(params.get('pr')) || null;
  const [docs, setDocs] = useState<ComponentDocsJson>(p.initial);
  const [base, setBase] = useState<string | null>(p.original);
  const [source, setSource] = useState<'main' | 'draft' | 'pr'>('main');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [previewText, setPreviewText] = useState(JSON.stringify(p.initial.preview ?? null, null, 2));
  const [previewError, setPreviewError] = useState('');
  /** True once the reader typed something (or the draft held this component): only then the draft is written. */
  const [dirty, setDirty] = useState(false);
  const ready = useRef(false);
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    let getToken: (() => string | null) | null = null;
    const check = () => setConnected(Boolean(getToken?.()));
    import('../scripts/github-session').then((m) => {
      getToken = m.getToken;
      check();
    });
    document.addEventListener('bridge:auth', check);
    return () => document.removeEventListener('bridge:auth', check);
  }, []);

  // Start from the draft in this browser, or the pull request's branch when opened from one.
  useEffect(() => {
    if (prRef) {
      fetch(`https://raw.githubusercontent.com/${p.repo.owner}/${p.repo.repo}/${encodeURIComponent(prRef)}/${p.path}`)
        .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
        .then((text) => {
          const d = JSON.parse(text) as ComponentDocsJson;
          setDocs(d);
          setBase(text);
          setPreviewText(JSON.stringify(d.preview ?? null, null, 2));
          setSource('pr');
          ready.current = true;
        })
        .catch(() => {
          setStatus(`Could not read ${p.name} docs on ${prRef}. Showing main.`);
          ready.current = true;
        });
      return;
    }
    const mine = docsEdits(readDraft()).find((e) => e.path === p.path);
    if (mine) {
      try {
        const d = JSON.parse(mine.after) as ComponentDocsJson;
        setDocs(d);
        setPreviewText(JSON.stringify(d.preview ?? null, null, 2));
        setSource('draft');
        setDirty(true);
      } catch {
        /* a broken draft entry: start from main */
      }
    }
    ready.current = true;
  }, []);

  const text = useMemo(() => docsText(docs), [docs]);
  // What gets written: a minimal diff of the file it replaces, so a hand-formatted docs.json keeps its layout.
  const fileText = useMemo(() => docsFileText(docs, base), [docs, base]);
  const issues = useMemo(() => validateDocs(cleanDocs(docs)), [docs]);
  // Compared in the editor's own format, so a hand-formatted file that is not edited does not count as changed.
  const baseText = useMemo(() => {
    try {
      return base === null ? null : docsText(JSON.parse(base) as ComponentDocsJson);
    } catch {
      return base;
    }
  }, [base]);
  const changed = baseText === null ? dirty : text !== baseText;

  // Every change goes to the local draft (not in pull request mode: that edits the branch).
  useEffect(() => {
    if (!ready.current || source === 'pr' || !dirty) return;
    const t = window.setTimeout(() => {
      const draft = readDraft();
      const next = changed
        ? setDocsEdit(draft, { path: p.path, component: p.name, slug: p.slug, before: p.original, after: fileText })
        : { ...draft, edits: draft.edits.filter((e) => !(e.kind === 'docs' && e.path === p.path)) };
      writeDraft(next);
      const inDraft = docsEdits(next).some((e) => e.path === p.path);
      setStatus(inDraft ? 'Saved to your draft, only in this browser.' : 'Same as main. Nothing in your draft.');
    }, 250);
    return () => window.clearTimeout(t);
  }, [text, fileText, source, dirty]);

  const set = <K extends keyof ComponentDocsJson>(k: K, v: ComponentDocsJson[K]) => {
    setDirty(true);
    setDocs((d) => ({ ...d, [k]: v }));
  };
  const setItem = (k: ListKey, i: number, v: string) => set(k, (docs[k] ?? []).map((x, j) => (j === i ? v : x)));
  const addItem = (k: ListKey) => set(k, [...(docs[k] ?? []), '']);
  const dropItem = (k: ListKey, i: number) => set(k, (docs[k] ?? []).filter((_, j) => j !== i));
  const setGuide = (k: GuideKey, i: number, patch: Partial<DocsGuidance>) => set(k, docs[k].map((g, j) => (j === i ? { ...g, ...patch } : g)));
  const addGuide = (k: GuideKey) => set(k, [...docs[k], { title: '', text: '' }]);
  const dropGuide = (k: GuideKey, i: number) => set(k, docs[k].filter((_, j) => j !== i));

  const list = (k: ListKey, label: string, hint: string) => (
    <div className="de-list">
      <p className="de-hint">{hint}</p>
      {(docs[k] ?? []).map((x, i) => (
        <div className="de-item" key={i}>
          <Textarea aria-label={`${label}, item ${i + 1}`} rows={1} maxRows={6} value={x} onChange={(e) => setItem(k, i, e.target.value)} />
          <IconButton icon={Trash2} label={`Remove ${label.toLowerCase()} item ${i + 1}`} size="sm" onClick={() => dropItem(k, i)} />
        </div>
      ))}
      <Button variant="ghost" size="sm" iconStart={Plus} onClick={() => addItem(k)}>
        Add item
      </Button>
    </div>
  );

  const guides = (k: GuideKey, label: string) => (
    <div className="de-list">
      {docs[k].map((g, i) => (
        <fieldset className="de-guide" key={i}>
          <legend className="sr-only">
            {label} {i + 1}
          </legend>
          <Input label="Title" size="sm" value={g.title} onChange={(e) => setGuide(k, i, { title: e.target.value })} />
          <Textarea label="Why" rows={2} maxRows={6} value={g.text} onChange={(e) => setGuide(k, i, { text: e.target.value })} />
          <div className="de-guide-foot">
            {g.example && <span className="de-hint">Keeps its rendered example.</span>}
            <Button variant="ghost" size="sm" iconStart={Trash2} onClick={() => dropGuide(k, i)}>
              Remove
            </Button>
          </div>
        </fieldset>
      ))}
      <Button variant="ghost" size="sm" iconStart={Plus} onClick={() => addGuide(k)}>
        Add {label.toLowerCase()}
      </Button>
    </div>
  );

  const onPreview = (v: string) => {
    setPreviewText(v);
    try {
      const node = JSON.parse(v) as ExampleNode | null;
      setPreviewError('');
      setDirty(true);
      setDocs((d) => {
        const { preview: _drop, ...rest } = d;
        return node ? { ...rest, preview: node } : (rest as ComponentDocsJson);
      });
    } catch {
      setPreviewError('Not valid JSON yet. The preview keeps the last valid example.');
    }
  };

  async function primary() {
    setBusy(true);
    try {
      if (source === 'pr' && prRef) {
        const { commitDocsToBranch } = await import('../scripts/docs-commit');
        const sha = await commitDocsToBranch(p.path, prRef, p.name, fileText);
        setBase(fileText);
        setStatus(sha ? `Committed to ${prRef}.` : 'Nothing to commit: the branch already has this text.');
        return;
      }
      const { proposeDocs } = await import('../scripts/docs-commit');
      const mine = docsEdits(readDraft()).filter((e) => e.path === p.path);
      const n = await proposeDocs(mine);
      writeDraft({ edits: readDraft().edits.filter((e) => !(e.kind === 'docs' && e.path === p.path)) });
      location.href = `/studio/changes/?pr=${n}`;
    } catch (err) {
      setStatus(`Not sent: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const discard = () => {
    if (!window.confirm(`Discard your changes to the ${p.name} docs?`)) return;
    writeDraft({ edits: readDraft().edits.filter((e) => !(e.kind === 'docs' && e.path === p.path)) });
    location.reload();
  };

  const review = docs.needsReview === true;
  const blocking = issues.length > 0;
  const primaryLabel = source === 'pr' ? `Commit to #${prNumber ?? prRef}` : 'Propose change';

  return (
    <div className="de">
      <div className="de-form">
        {review && (
          <div className="de-review" role="status">
            <span className="pill is-info">Draft by Claude, needs review</span>
            <p>Read every sentence against the code, fix what is wrong, then mark it reviewed.</p>
            <Button variant="secondary" size="sm" onClick={() => set('needsReview', false)}>
              Mark as reviewed
            </Button>
          </div>
        )}
        <Section id="de-summary" title="Summary" open>
          <p className="de-hint" id="de-summary-hint">
            One or two sentences: what it is for, and what to use instead when it is not.
          </p>
          <Textarea aria-label="Summary" aria-describedby="de-summary-hint" rows={2} value={docs.summary} onChange={(e) => set('summary', e.target.value)} />
        </Section>
        <Section id="de-when" title="When to use" count={docs.whenToUse.length + docs.whenNotToUse.length} open>
          <h3 className="de-h">Use it for</h3>
          {list('whenToUse', 'Use it for', 'One situation per item, starting with the job to do.')}
          <h3 className="de-h">Not for</h3>
          {list('whenNotToUse', 'Not for', 'Name what to use instead.')}
        </Section>
        <Section id="de-dos" title="Do" count={docs.dos.length}>
          {guides('dos', 'Do')}
        </Section>
        <Section id="de-donts" title="Don't" count={docs.donts.length}>
          {guides('donts', "Don't")}
        </Section>
        <Section id="de-a11y" title="Accessibility" count={docs.accessibility.length}>
          {list('accessibility', 'Accessibility', 'What the component does for keyboard and screen reader users, and what the product team must still do.')}
        </Section>
        <Section id="de-content" title="Content guidelines" count={docs.contentGuidelines?.length ?? 0}>
          {list('contentGuidelines', 'Content guidelines', 'How to write the words inside it.')}
        </Section>
        <Section id="de-anatomy" title="Anatomy" count={Object.keys(docs.anatomy ?? {}).length}>
          <p className="de-hint">Keyed by the CSS module classes, read from the code. Name each part the way a designer would.</p>
          <div className="de-anatomy">
            {Object.entries(docs.anatomy ?? {}).map(([k, v]) => (
              <Input key={k} label={k} size="sm" value={v} onChange={(e) => set('anatomy', { ...(docs.anatomy ?? {}), [k]: e.target.value })} />
            ))}
          </div>
        </Section>
        <Section id="de-preview" title="Preview example">
          <p className="de-hint" id="de-preview-hint">
            Components and props, like <code>{'{ "c": "Button", "p": { "variant": "primary" }, "children": ["Save"] }'}</code>.
          </p>
          <Textarea
            aria-label="Preview example as JSON"
            aria-describedby="de-preview-hint"
            className="de-code"
            rows={6}
            maxRows={18}
            spellCheck={false}
            value={previewText}
            error={previewError || undefined}
            onChange={(e) => onPreview(e.target.value)}
          />
        </Section>
        <Section id="de-facts" title="From the code">
          <p className="de-hint">Computed from {p.name}.tsx and its stylesheet. The same pre-fill feeds the MCP tool bridge_draft_docs and the docs-draft check.</p>
          <dl className="de-facts">
            <div>
              <dt>Tokens</dt>
              <dd>{p.facts.tokens}</dd>
            </div>
            <div>
              <dt>Changelog line</dt>
              <dd>{p.facts.changelogLine}</dd>
            </div>
            {p.facts.contrastNotes.length > 0 && (
              <div>
                <dt>Contrast</dt>
                <dd>
                  <ul>
                    {p.facts.contrastNotes.slice(0, 4).map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                </dd>
              </div>
            )}
          </dl>
          {p.facts.propsTable && <pre className="de-props">{p.facts.propsTable}</pre>}
          <p className="de-hint">
            Draft the prose with your own Claude: <code>npm run bridge -- docs draft {p.name}</code>
          </p>
        </Section>
      </div>

      <section className="de-preview" aria-label={`${p.name} Library page, live preview`}>
        <p className="de-preview-label">Library preview</p>
        <div className="de-preview-page">
          <h2 className="de-preview-title">{p.name}</h2>
          {docs.summary.trim() ? <p className="de-preview-lead">{docs.summary}</p> : <p className="de-note">No summary yet.</p>}
          {docs.preview && (
            <div className="de-stage stage-checker">
              <ClientExample node={docs.preview as ExampleNode} />
            </div>
          )}
          <UsagePanel docs={docs} Example={ClientExample} idPrefix="pv-" />
        </div>
      </section>

      <footer className="de-bar" aria-label="Docs actions">
        <p className="de-status" role="status" aria-live="polite">
          {blocking ? issues[0]!.message : status || (changed ? 'Your changes are saved to your draft.' : 'No changes yet.')}
        </p>
        {changed && source !== 'pr' && (
          <Button variant="ghost" size="sm" onClick={discard}>
            Discard changes
          </Button>
        )}
        {connected ? (
          <Button variant="primary" disabled={busy || blocking || !changed} loading={busy} onClick={primary}>
            {primaryLabel}
          </Button>
        ) : (
          <Button variant="primary" disabled={blocking || !changed} data-gh-open="">
            Connect GitHub to propose
          </Button>
        )}
      </footer>
    </div>
  );
}
