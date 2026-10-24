// Library > Components > one component, for any repo model: the same tabs on Bridge's own page (pages/components/
// [slug].astro, rendered at build time) and on a team's Library (LibraryTeamComponents.tsx, in the browser). Usage
// (docs.json), Tokens (anatomy and motion), Code (props, playground, workbench) and Changelog (release notes that name
// it). Previews come from the design system's own Storybook (decision D2), in light and dark. The page script
// (scripts/component-page.ts) drives the tabs, the preview switch and the "On this page" rail through data attributes.
//
// What only a hydrated island can do comes in as slots: `heroTools` (the preview brand and density menu) and
// `playground` (PropsPlayground). `Example` draws docs.json examples with the real components: only Bridge, which runs
// its own components, has one; a team's guidance reads as text. Repo content reaches the page as React text only.
import type { ComponentType, ReactNode } from 'react';
import { Alert, Badge, CodeBlock, Link, PageHeader, SegmentedControl } from '@bridge-ds/react';
import { BookOpen, Columns2, FileCode, Lock, Moon, Pencil, Sun } from 'lucide-react';
import { storybookIframeUrl, storybookManagerUrl, type ExampleNode } from '@bridge-ds/core';
import ButtonLink from '../../ButtonLink';
import PropsTable from '../../PropsTable';
import MotionTable from '../../MotionTable';
import UsagePanel from '../../../UsagePanel';
import { playgroundSpec, type ComponentInfo } from '../../../../lib/library/components';
import { COMPONENT_TABS, componentMotion, componentNotes, exampleCode, mainStory, previewUrl, readableDocs, STATUS_LABEL, STATUS_TONE, statusOf, tokenKindCounts } from '../../../../lib/library/component-page';
import { tokenAxes } from '../../../../lib/library/tokens';
import { humanDate } from '../../../../lib/library/stats';
import { mdTitleParts } from '../../../../lib/markdown';
import { componentHref, libraryLink, pageHref, sourceHref, type LibraryData } from '../library-data';

export interface ComponentViewProps {
  data: LibraryData;
  component: ComponentInfo;
  /** Draws a docs.json example with the real components (Bridge's own Library only). */
  Example?: ComponentType<{ node: ExampleNode }> | undefined;
  /** The preview brand and density menu of the hero bar (a hydrated island on a static page). */
  heroTools?: ReactNode;
  /** The props playground (PropsPlayground), when the component has one and a Storybook to drive. */
  playground?: ReactNode;
  /** "Figma is ahead" while build requests for this component are open (FigmaAhead), by the hero. */
  ahead?: ReactNode;
}

const tokenLink = (data: LibraryData, path: string) => pageHref(data, `tokens/?t=${encodeURIComponent(path)}`);

/** A release note title with its inline code, as React text. */
function NoteTitle({ md }: { md: string }) {
  return (
    <p>
      {mdTitleParts(md).map((p, i) => (p.code ? <code key={i}>{p.text}</code> : <span key={i}>{p.text}</span>))}
    </p>
  );
}

/** Where a team's previews come from, when it has not said yet. */
export function StorybookNotice({ name }: { name: string }) {
  return (
    <div className="tp-locked cp-sb-notice">
      <p>
        <strong>Add the Storybook to see {name} live here.</strong> Set <span className="mono">storybook.url</span> in <span className="mono">bridge.config.json</span>.
      </p>
    </div>
  );
}

/**
 * What the page shows in place of the preview when the published Storybook does not list the story yet (the page
 * script checks the index and turns it on): the code, and when the preview comes.
 */
function StoryMissing({ name, code }: { name: string; code: string }) {
  return (
    <div className="cp-sb-missing" data-sb-missing-note="">
      <p className="muted">Preview appears after the next Storybook update.</p>
      <CodeBlock code={code} label={`${name} example`} />
    </div>
  );
}

/** One story in one theme, as the hero and the playground fallback show it. Inert: the playground is for trying. */
function StoryPane({ storybook, storyId, theme, name, className }: { storybook: string; storyId: string; theme: string; name: string; className: string }) {
  return (
    <iframe
      className={className}
      src={previewUrl(storybook, storyId, { theme })}
      title={`${name} preview, ${theme === 'dark' ? 'dark' : 'light'} theme`}
      data-sb-preview=""
      data-sb-base={storybook}
      data-sb-story={storyId}
      data-sb-theme={theme}
      sandbox="allow-scripts allow-same-origin allow-popups"
      referrerPolicy="no-referrer"
      loading="lazy"
    />
  );
}

export default function ComponentView({ data, component: c, Example, heroTools, playground, ahead }: ComponentViewProps) {
  const { model, extras } = data;
  const d = readableDocs(c.docs);
  const status = statusOf(c);
  const story = mainStory(c);
  const storybook = extras.storybook;
  const { modes } = tokenAxes(model);
  const unknownTokens = c.tokensUsed.filter((t) => !t.known);
  const spec = playgroundSpec(c);
  const counts = tokenKindCounts(c);
  const inheritedVia = c.inherited.filter((i) => i.paths.length);
  const chipHref = (v: { path?: string | undefined; href?: string | undefined }) => (v.path ? tokenLink(data, v.path) : v.href ? libraryLink(data, v.href) : undefined);
  const tsx = sourceHref(data, c.files.tsx);
  const css = sourceHref(data, c.files.css);
  const fileLinks = [
    { label: `${c.name}.tsx`, href: tsx },
    { label: `${c.name}.module.css`, href: css },
    ...(d ? [{ label: `${c.name}.docs.json`, href: sourceHref(data, c.files.docs) }] : []),
  ].filter((f): f is { label: string; href: string } => Boolean(f.href));
  const notes = componentNotes(c.name, extras.releases ?? []);
  const motion = componentMotion(model, c, extras.motion);
  const manager = storybook && story ? storybookManagerUrl(storybook, story.id) : undefined;
  const own = !data.team;
  // Edit mode on the page itself (?edit=1), on Bridge's own Library and on a team's.
  const editHref = own ? `/components/${c.slug}/?edit=1` : `${componentHref(data, c.slug)}?edit=1`;
  const file = (path: string, href: string | undefined) => (href ? <Link href={href}><code>{path}</code></Link> : <code>{path}</code>);
  const locked = (
    <p className="le-locked le-locked-note" data-le-locked="">
      <Badge icon={Lock}>From the code</Badge> <span>Generated from the component, not editable here.</span>
    </p>
  );

  return (
    <div className="cp-page" data-sb-check-base={storybook && story ? storybook : undefined} data-sb-check-story={storybook && story ? story.id : undefined}>
      <div className="le-bar-slot" data-le-bar=""></div>
      <div className="cp-main">
        <div className="cp-head">
          <PageHeader
            className="lib-page-header"
            title={c.name}
            lead={
              <>
                <span data-le-lead="">{d?.summary}</span>
                <span className="le-summary-slot" data-le-summary=""></span>
              </>
            }
            meta={
              <>
                <span data-le-read-only="">
                  <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
                </span>
                <span data-le-status=""></span>
              </>
            }
            actions={
              own || extras.canEdit ? (
                <span data-maintainer-only={own ? '' : undefined} data-le-read-only="">
                  <ButtonLink variant="secondary" size="sm" href={editHref} iconStart={Pencil} data-le-edit="">
                    Edit
                  </ButtonLink>
                </span>
              ) : undefined
            }
          />
          <div className="cp-meta">
            <ul className="cp-links" aria-label="Resources">
              {manager && (
                <li data-sb-needs-story="">
                  <ButtonLink variant="secondary" size="sm" href={manager} iconStart={BookOpen}>
                    Workbench
                  </ButtonLink>
                </li>
              )}
            </ul>
          </div>
        </div>
        <div data-le-rail-narrow=""></div>
        {ahead}

        {story && storybook && <StoryMissing name={c.name} code={exampleCode(c.name, spec?.children)} />}
        {story && storybook && (
          <section className="hero-stage" data-view="split" aria-label={`${c.name} preview`} data-sb-needs-story="">
            <div className="hero-stage-bar">
              <SegmentedControl
                label="Preview theme"
                size="sm"
                data-vanilla=""
                data-hero-view=""
                defaultValue="split"
                items={[
                  { value: 'light', label: 'Light', icon: Sun },
                  { value: 'dark', label: 'Dark', icon: Moon },
                  { value: 'split', label: 'Side by side', icon: Columns2 },
                ]}
              />
              <span className="hero-stage-note" data-le-read-only="">
                Rendered with the real component
              </span>
              <span className="le-locked" data-le-locked="">
                <Badge icon={Lock}>From the code</Badge>
              </span>
              {heroTools}
            </div>
            <div className="hero-stage-panes">
              {modes.map((m) => (
                <div key={m} className="hero-pane hero-pane-frame stage-checker" data-theme={m} data-pane={m}>
                  <span className="pane-label">{m === 'light' ? 'Light' : 'Dark'}</span>
                  <StoryPane className="sb-frame" storybook={storybook} storyId={story.id} theme={m} name={c.name} />
                </div>
              ))}
            </div>
          </section>
        )}
        {story && !storybook && <StorybookNotice name={c.name} />}

        {!d && (
          <Alert tone="warning" announce="off" className="lib-block-gap" data-le-read="">
            No usage guidance yet. Add <code>{c.files.docs}</code> to fill this page. Props and tokens below are generated from the code.
          </Alert>
        )}

        <nav className="page-tabs" role="tablist" aria-label={`${c.name} documentation`} data-cp-tabs="">
          {COMPONENT_TABS.map((t, i) => (
            <Link
              key={t.id}
              variant="subtle"
              role="tab"
              id={`tab-${t.id}-btn`}
              href={`#${t.id}`}
              aria-controls={`tab-${t.id}`}
              aria-selected={i === 0 ? 'true' : 'false'}
              tabIndex={i === 0 ? 0 : -1}
              data-tab={t.id}
            >
              {t.label}
              {t.id === 'changelog' && notes.length > 0 && <span className="muted num"> {notes.length}</span>}
            </Link>
          ))}
        </nav>

        <div className="cp-layout">
          <div className="cp-body">
            <div className="cp-panel" role="tabpanel" id="tab-usage" aria-labelledby="tab-usage-btn" data-panel="usage">
              <div data-le-read="">
                {d && <UsagePanel docs={d} Example={Example} />}
                {!d && (
                  <p className="muted">
                    No usage guidance yet. Add <code>{c.files.docs}</code> to fill this tab.
                  </p>
                )}
              </div>
              <div data-le-usage=""></div>
            </div>

            <div className="cp-panel" role="tabpanel" id="tab-tokens" aria-labelledby="tab-tokens-btn" data-panel="tokens">
              {locked}
              <section aria-labelledby="anatomy">
                <h2 id="anatomy">Anatomy and tokens</h2>
                <p>
                  Read from {file(c.files.css, css)} {own ? 'at build time' : 'when this Library was published'}. Every value is a token: open one to see its alias chain in both themes.
                </p>
                <div className="token-summary">
                  <Badge>
                    {c.tokenPaths.length} {inheritedVia.length ? 'own tokens' : 'tokens'}
                  </Badge>
                  {inheritedVia.map((i) => (
                    <Badge key={i.from}>
                      {i.paths.length} from {i.from}
                    </Badge>
                  ))}
                  <Badge tone="info">{counts.semantic} semantic or component, change with theme and brand</Badge>
                  {counts.density > 0 && <Badge>{counts.density} density, change with comfortable or compact</Badge>}
                  <Badge>{counts.primitive} from the shared scales</Badge>
                </div>
                {unknownTokens.length > 0 && (
                  <Alert tone="warning" announce="off" title="Unknown tokens" className="lib-block-gap">
                    {unknownTokens.map((t) => t.name).join(', ')}. They are not defined in the token sources and will render as nothing.
                  </Alert>
                )}
                <ul className="anatomy">
                  {c.rules.map((r, ri) => (
                    <li key={`${r.selector}-${ri}`} className="anatomy-row">
                      <div className="anatomy-part">
                        <strong>{r.label}</strong>
                        <code className="anatomy-sel">{r.selector}</code>
                      </div>
                      <div className="anatomy-tokens">
                        {r.vars.map((v, vi) => {
                          const href = chipHref(v);
                          return href ? (
                            <Link key={vi} variant="subtle" className={`tchip ${v.kind === 'primitive' || v.kind === 'brand' ? 'is-primitive' : 'is-semantic'}`} href={href}>
                              {v.name}
                            </Link>
                          ) : (
                            <span key={vi} className="tchip is-unknown">
                              {v.name}
                            </span>
                          );
                        })}
                      </div>
                    </li>
                  ))}
                </ul>
                {inheritedVia.map((i) => (
                  <section key={i.slug} className="cp-inherited" aria-labelledby={`inherited-${i.slug}`}>
                    <h3 id={`inherited-${i.slug}`}>From {i.from}</h3>
                    <p className="muted">
                      {c.name} reuses the stylesheet of <Link href={componentHref(data, i.slug, '#tokens')}>{i.from}</Link>, so it also paints with these {i.paths.length} tokens. Changing them changes both.
                    </p>
                    <div className="anatomy-tokens">
                      {i.paths.map((p) => (
                        <Link key={p} variant="subtle" className="tchip is-semantic" href={tokenLink(data, p)}>
                          --{p.replace(/\./g, '-')}
                        </Link>
                      ))}
                    </div>
                  </section>
                ))}
              </section>

              <section aria-labelledby="motion">
                <h2 id="motion">Motion and interaction</h2>
                {motion ? (
                  <>
                    <p>
                      {motion.summary}
                      {motion.rows.length > 0 && story && storybook && ' Try it in the preview at the top.'}
                    </p>
                    {motion.rows.length > 0 && <MotionTable component={c.name} rows={motion.rows} showPart={motion.showPart} tokenHref={(t) => tokenLink(data, t)} />}
                    {motion.reduced && <p className="motion-note">{motion.reduced}</p>}
                    {motion.rows.length > 0 && motion.unlisted.length > 0 && (
                      <p className="small muted">
                        It also uses{' '}
                        {motion.unlisted.map((t, i) => (
                          <span key={t}>
                            {i > 0 && ', '}
                            <Link variant="subtle" href={tokenLink(data, t)}>
                              <code>{t}</code>
                            </Link>
                          </span>
                        ))}{' '}
                        for motion this table does not list yet.
                      </p>
                    )}
                  </>
                ) : (
                  <p className="muted">No motion reading for {c.name} yet: its component specs could not be read.</p>
                )}
              </section>
            </div>

            <div className="cp-panel" role="tabpanel" id="tab-code" aria-labelledby="tab-code-btn" data-panel="code">
              {locked}
              {fileLinks.length > 0 && (
                <ul className="cp-files" aria-label="Source files">
                  {fileLinks.map((f) => (
                    <li key={f.label}>
                      <ButtonLink variant="secondary" size="sm" href={f.href} iconStart={FileCode}>
                        {f.label}
                      </ButtonLink>
                    </li>
                  ))}
                </ul>
              )}
              <section aria-labelledby="props">
                <h2 id="props">Props</h2>
                <p>
                  Parsed from the TypeScript types in {file(c.files.tsx, tsx)}, so this table cannot drift from the code.
                  {c.inherits && (
                    <>
                      {' '}
                      It also accepts every native <code>{`<${c.inherits}>`}</code> attribute
                      {c.omitted.length > 0 ? (
                        <>
                          {' '}
                          except <code>{c.omitted.join(', ')}</code>.
                        </>
                      ) : (
                        '.'
                      )}
                    </>
                  )}
                </p>
                {c.props.length > 0 ? (
                  <PropsTable component={c.name} rows={c.props} />
                ) : (
                  <p className="muted">
                    No props of its own.{c.description && ` ${c.description}`}
                  </p>
                )}
                {c.subcomponents.length > 0 && (
                  <p>
                    Comes with{' '}
                    {c.subcomponents.map((s, i) => (
                      <span key={s}>
                        {i > 0 && ', '}
                        <code>{s}</code>
                      </span>
                    ))}
                    , each accepting native <code>&lt;div&gt;</code> attributes.
                  </p>
                )}
              </section>

              <section aria-labelledby="playground">
                <h2 id="playground">Playground</h2>
                {!story || !storybook ? (
                  story ? (
                    <StorybookNotice name={c.name} />
                  ) : (
                    <p className="muted">{c.name} has no story in the Storybook yet, so there is nothing to play with here.</p>
                  )
                ) : spec ? (
                  <>
                    <p className="muted">Change the props and see the real {c.name} update. Controls are generated from the TypeScript props; nothing here changes the system.</p>
                    {playground}
                  </>
                ) : (
                  <>
                    <p className="muted">
                      {c.name} has no typed options to play with: it is a container. Compose it with{' '}
                      {c.subcomponents.length > 0
                        ? c.subcomponents.map((s, i) => (
                            <span key={s}>
                              {i > 0 && ', '}
                              <code>{s}</code>
                            </span>
                          ))
                        : 'other components'}{' '}
                      and any native attribute. Here it is in both themes.
                    </p>
                    <div className="pg-fallback" data-sb-needs-story="">
                      {modes.map((m) => (
                        <div key={m} className="pg-stage pg-stage-frame stage-checker" data-theme={m}>
                          <span className="pane-label">{m === 'light' ? 'Light' : 'Dark'}</span>
                          <StoryPane className="sb-frame" storybook={storybook} storyId={story.id} theme={m} name={c.name} />
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </section>

              <section aria-labelledby="live">
                <h2 id="live">Workbench</h2>
                <p>
                  For contributors: every state with the accessibility panel, in the component workbench (Storybook). The stories double as visual test fixtures; the guidance on this page is the
                  user documentation
                  {manager && (
                    <>
                      {' '}
                      (<Link href={manager}>open {c.name} in Storybook</Link>)
                    </>
                  )}
                  .
                </p>
                {story && storybook && (
                  <details className="stories">
                    <summary>Embed Storybook stories here ({c.stories.length})</summary>
                    <p className="small muted">
                      Loads from <code>{storybook}</code>
                      {own && (
                        <>
                          {' '}
                          (set <code>STORYBOOK_URL</code> at build time)
                        </>
                      )}
                      . If Storybook is not running, the frames stay empty.
                    </p>
                    {c.stories.map((s) => (
                      <div key={s.id}>
                        <h4>{s.name}</h4>
                        <iframe className="story-frame" src={storybookIframeUrl(storybook, s.id)} title={`${c.name} story: ${s.name}`} loading="lazy" sandbox="allow-scripts allow-same-origin allow-popups" referrerPolicy="no-referrer" />
                      </div>
                    ))}
                  </details>
                )}
              </section>
            </div>

            <div className="cp-panel" role="tabpanel" id="tab-changelog" aria-labelledby="tab-changelog-btn" data-panel="changelog">
              {locked}
              <section aria-labelledby="changes">
                <h2 id="changes">Changelog</h2>
                {notes.length ? (
                  <ul className="cp-changes">
                    {notes.map((e, i) => (
                      <li key={i}>
                        <Badge>{e.kind}</Badge>
                        <div>
                          <NoteTitle md={e.title} />
                          <p className="small muted">
                            {e.release}
                            {e.date && <>, {humanDate(e.date)}</>}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">No release note mentions {c.name} yet.</p>
                )}
                <p className="small">
                  <Link href={pageHref(data, 'changelog/')}>All release notes</Link>
                </p>
              </section>
            </div>
          </div>
        </div>
      </div>

      <aside className="cp-toc" aria-label="On this page">
        <p className="cp-toc-title" data-le-read="">
          On this page
        </p>
        <ul data-cp-toc="" data-le-read=""></ul>
        <div data-le-rail=""></div>
      </aside>
    </div>
  );
}
