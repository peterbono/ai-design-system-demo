// Studio new brand flow: four focused steps on one page (Start from, Colors, Shape and type, Review), one primary
// action per step. A hydrated island (client:load) because it renders real Bridge components in the preview,
// scoped to the draft brand with CSS variable overrides. The draft stays in this browser until "Propose brand".
// Planning, ramps and the contrast gate come from @bridge-ds/core (planNewBrand), the same code the CLI, the MCP
// server and the Figma plugin run.
import { type CSSProperties, useDeferredValue, useEffect, useId, useMemo, useState } from 'react';
import {
  Accordion,
  AccordionItem,
  Alert,
  Badge,
  Button,
  Checkbox,
  ChoiceCard,
  ChoiceCardGroup,
  Input,
  Link,
  Select,
  Slider,
  Switch,
  TokenValue,
} from '@bridge-ds/react';
import { ArrowLeft, ArrowRight, CircleAlert, CircleCheck, GitBranch } from 'lucide-react';
import { BRAND_FONTS, RADIUS_PRESETS, type BrandSource, brandPreviewVariables, checkBrandSlug, listBrands, loadConfig } from '@bridge-ds/core';
import {
  type BrandDraft,
  STEPS,
  brandFacts,
  contrastLine,
  draftSlug,
  emptyDraft,
  hueOf,
  loadDraft,
  normalizeHex,
  pairLabel,
  planDraft,
  radiusOf,
  saveDraft,
  withHue,
} from '../../../lib/new-brand';
import { ghAuthFailure, hasWorkingToken, tokenRejected } from '../../../scripts/github-session';
import { type ProposedBrand, proposeBrand } from '../../../scripts/new-brand';
import { ghAction } from '../../../lib/gh-wording';
import { parseJiraKey, VOCAB } from '../../../lib/vocabulary';

export interface NewBrandFlowProps {
  files: Record<string, string>;
  configText: string;
  contrastText: string;
  /** The site has Sign in with GitHub (a GitHub App): the connect action says "Sign in". */
  signIn?: boolean;
}

const RADIUS_SCALE = [0, 2, 4, 6, 10, 12, 16, 20];
const RADIUS_STEP: Record<number, string> = { 0: 'none', 2: 'xs', 4: 'sm', 6: 'md', 10: 'lg', 12: 'xl', 16: '2xl', 20: '3xl' };
const ROLE_LABEL = { inset: 'Inset (checkboxes, tags)', control: 'Controls (buttons, inputs)', container: 'Containers (cards, menus)', overlay: 'Overlays (dialogs, toasts)' } as const;

export default function NewBrandFlow({ files, configText, contrastText, signIn = false }: NewBrandFlowProps) {
  const source = useMemo<BrandSource>(() => ({ config: loadConfig(configText), configText, files, contrastText }), [files, configText, contrastText]);
  const brands = useMemo(() => listBrands(source), [source]);
  const facts = useMemo(() => Object.fromEntries(brands.map((b) => [b.slug, brandFacts(source, b.slug)])), [brands, source]);
  const defaultBrand = brands.find((b) => b.default)?.slug ?? brands[0]?.slug ?? 'bridge';
  const [draft, setDraft] = useState<BrandDraft>(() => emptyDraft(defaultBrand, facts[defaultBrand]));
  const [restored, setRestored] = useState(false);
  const [connected, setConnected] = useState(false);
  const [rejected, setRejected] = useState(false);
  const [slugOpen, setSlugOpen] = useState(false);
  const [pairsOpen, setPairsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorHref, setErrorHref] = useState<string | null>(null);
  const [done, setDone] = useState<ProposedBrand | null>(null);
  const [jira, setJira] = useState('');
  const headingId = useId();

  useEffect(() => {
    const d = loadDraft(brands.map((b) => b.slug));
    if (d) {
      setDraft(d);
      if (d.slug !== undefined) setSlugOpen(true);
    }
    setRestored(true);
    const sync = () => {
      setConnected(hasWorkingToken());
      setRejected(tokenRejected());
    };
    sync();
    document.addEventListener('bridge:auth', sync);
    return () => document.removeEventListener('bridge:auth', sync);
  }, [brands]);
  useEffect(() => {
    if (restored && !done) saveDraft(draft);
  }, [draft, restored, done]);

  const deferred = useDeferredValue(draft);
  const plan = useMemo(() => planDraft(source, deferred), [source, deferred]);
  const vars = useMemo(() => ({ light: brandPreviewVariables(source, plan, 'light'), dark: brandPreviewVariables(source, plan, 'dark') }), [source, plan]);

  const set = (patch: Partial<BrandDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const go = (step: number) => {
    set({ step });
    setError(null);
    requestAnimationFrame(() => document.getElementById(headingId)?.focus());
  };

  const slug = draftSlug(draft);
  const slugIssues = draft.name.trim() || draft.slug !== undefined ? checkBrandSlug(source.config, source.files, slug) : [];
  const contrast = contrastLine(plan);
  const errors = plan.issues.filter((i) => i.level === 'error' && !(i.code.startsWith('slug-') && !slug));
  const pinWarning = plan.issues.find((i) => i.code === 'pin-off-ladder' && i.path === 'palette.primary');
  const step = STEPS[draft.step]!;
  const canContinue = draft.step === 0 ? Boolean(draft.name.trim()) && slugIssues.length === 0 : true;
  const ready = slugIssues.length === 0 && Boolean(slug) && errors.length === 0 && plan.contrast.failing.length === 0;

  const propose = async () => {
    setBusy(true);
    setError(null);
    try {
      const repo = source.config.repo ?? { owner: 'peterbono', name: 'ai-design-system-demo', defaultBranch: 'main' };
      const pr = await proposeBrand(draft, repo, source.config.tokens.root, parseJiraKey(jira));
      setDone(pr);
      saveDraft(null);
    } catch (e) {
      const auth = ghAuthFailure(e, 'create branches');
      setError(auth?.text ?? (e as Error).message);
      setErrorHref(auth?.href ?? null);
    } finally {
      setBusy(false);
    }
  };

  const previews = (
    <div className="nb-previews">
      <BrandPreview theme="light" vars={vars.light} name={draft.name.trim() || 'New brand'} />
      <BrandPreview theme="dark" vars={vars.dark} name={draft.name.trim() || 'New brand'} />
    </div>
  );
  const contrastRow = (
    <div className="nb-contrast" data-ok={contrast.ok || undefined} aria-live="polite">
      <span className="nb-contrast-line">
        {contrast.ok ? <CircleCheck aria-hidden="true" className="nb-contrast-icon" /> : <CircleAlert aria-hidden="true" className="nb-contrast-icon" />}
        <span>{contrast.text}</span>
        {!contrast.ok && plan.contrast.failing.length > 0 && (
          <Button variant="ghost" size="sm" aria-expanded={pairsOpen} aria-controls="nb-pairs" onClick={() => setPairsOpen((o) => !o)}>
            {pairsOpen ? 'Hide pairs' : 'See pairs'}
          </Button>
        )}
      </span>
      {!contrast.ok && pairsOpen && (
        <ul className="nb-pairs" id="nb-pairs">
          {plan.contrast.failing.slice(0, 12).map((r) => (
            <li key={`${r.fg}|${r.bg}|${r.modes}`}>
              <span>{pairLabel(r.fg, r.bg)}</span>
              <span className="nb-pair-meta num">
                {r.modes.includes('theme=dark') ? 'Dark' : 'Light'}, {r.ratio ?? 'n/a'}:1, needs {r.min}:1
              </span>
            </li>
          ))}
          {plan.contrast.failing.length > 12 && <li className="nb-pair-meta">and {plan.contrast.failing.length - 12} more</li>}
        </ul>
      )}
    </div>
  );

  if (done) {
    return (
      <section className="nb" aria-labelledby={headingId}>
        <div className="nb-done">
          <h2 className="nb-step-title" id={headingId} tabIndex={-1}>
            Branch created
          </h2>
          <p className="nb-lead">{draft.name} stays a draft on its own branch until design and tech approve it. The Library shows it once it is merged into main.</p>
          <div className="nb-actions">
            <Button variant="primary" iconStart={GitBranch} render={<a href={`/studio/changes/?pr=${done.number}`} />}>
              Open the branch
            </Button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="nb" aria-labelledby={headingId}>
      <ol className="nb-steps" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s.id} aria-current={i === draft.step ? 'step' : undefined} data-done={i < draft.step || undefined}>
            <span className="nb-step-n num" aria-hidden="true">
              {i + 1}
            </span>
            <span>{s.label}</span>
          </li>
        ))}
      </ol>

      {/* The step list already shows where you are: the heading is for screen readers and focus after Back or Continue. */}
      <h2 className="nb-step-title sr-only" id={headingId} tabIndex={-1}>
        Step {draft.step + 1} of {STEPS.length}: {step.label}
      </h2>

      {draft.step === 0 && (
        <div className="nb-body nb-narrow">
          <div className="nb-field">
            <Input
              label="Brand name"
              placeholder="Acme"
              value={draft.name}
              onValueChange={(name) => set({ name })}
              autoComplete="off"
              error={!slugOpen && slugIssues.length ? slugIssues[0]!.message : undefined}
              hint={
                slug ? (
                  <>
                    Saved as <span className="mono">brands/{slug}.tokens.json</span>
                  </>
                ) : (
                  'The name people pick in brand menus.'
                )
              }
            />
            {!slugOpen && slug && (
              <Button variant="ghost" size="sm" className="nb-inline-action" onClick={() => (setSlugOpen(true), set({ slug }))}>
                Change slug
              </Button>
            )}
            {slugOpen && (
              <Input
                label="Slug"
                value={draft.slug ?? slug}
                onValueChange={(v) => set({ slug: v })}
                autoComplete="off"
                spellCheck={false}
                error={slugIssues.length ? slugIssues[0]!.message : undefined}
                hint="Lowercase letters, digits and dashes. Used in data-brand and file names."
              />
            )}
          </div>
          <ChoiceCardGroup
            label="Start from"
            description="The new brand copies its status colors, type roles and theme overrides. You change colors, corners and fonts next."
            value={draft.from}
            onValueChange={(from) => {
              const f = facts[from];
              set({ from, ...(f ? { radius: f.radius, heading: f.heading, text: f.text, radiusRoles: {}, ...(draft.primary === facts[draft.from]?.primary ? { primary: f.primary } : {}), ...(draft.neutral === facts[draft.from]?.neutral ? { neutral: f.neutral } : {}) } : {}) });
            }}
          >
            {brands.map((b) => (
              <ChoiceCard
                key={b.slug}
                value={b.slug}
                title={b.name}
                description={
                  <>
                    {b.primary && (
                      <>
                        Primary <TokenValue value={b.primary} size="sm" />.{' '}
                      </>
                    )}
                    {facts[b.slug]?.fonts}, corners {facts[b.slug]?.radiusPx.control} px{b.overrides.length ? ', with light and dark overrides' : ''}.
                  </>
                }
              />
            ))}
          </ChoiceCardGroup>
        </div>
      )}

      {draft.step === 1 && (
        <div className="nb-body nb-split">
          <div className="nb-controls">
            <ColorField
              label="Primary"
              description={`Buttons, links, checked controls and zones. Your color sits at step ${plan.actionStep}, the one buttons use.`}
              value={draft.primary}
              onChange={(primary) => set({ primary })}
              swatches={plan.ramps.primary ?? []}
              mark={plan.actionStep}
              warning={pinWarning?.message}
            />
            <ColorField label="Neutral" description="Text, lines and backgrounds. A grey gives a pure grey; a tint carries its hue into every step." value={draft.neutral} onChange={(neutral) => set({ neutral })} swatches={plan.ramps.neutral ?? []} />
            <Accordion appearance="flush" headingLevel={3} defaultValue={draft.accent || draft.link ? ['more'] : []}>
              <AccordionItem value="more" title="More colors" meta={draft.accent || draft.link ? 'Custom' : 'Follow primary'}>
                <div className="nb-more">
                  <Input label="Accent" placeholder="Same as primary" value={draft.accent} onValueChange={(accent) => set({ accent })} hint="Signal, focus ring and progress." error={draft.accent && !normalizeHex(draft.accent) ? 'Use a 6-digit hex, or leave it empty.' : undefined} />
                  <Input label="Link" placeholder="Same as primary" value={draft.link} onValueChange={(link) => set({ link })} hint="Text links." error={draft.link && !normalizeHex(draft.link) ? 'Use a 6-digit hex, or leave it empty.' : undefined} />
                </div>
              </AccordionItem>
            </Accordion>
          </div>
          <div className="nb-stage">
            {previews}
            {contrastRow}
          </div>
        </div>
      )}

      {draft.step === 2 && (
        <div className="nb-body nb-split">
          <div className="nb-controls">
            <ChoiceCardGroup label="Corners" orientation="vertical" value={draft.radius} onValueChange={(radius) => set({ radius, radiusRoles: {} })}>
              {RADIUS_PRESETS.map((p) => (
                <ChoiceCard
                  key={p.id}
                  value={p.id}
                  title={p.label}
                  description={
                    <>
                      {p.hint}
                      <span className="nb-corner" aria-hidden="true" style={{ '--nb-corner': `var(--radius-${RADIUS_STEP[p.radius.control]})` } as CSSProperties} />
                    </>
                  }
                />
              ))}
            </ChoiceCardGroup>
            <Select label="Heading font" value={draft.heading} onValueChange={(v) => v && set({ heading: v })} options={BRAND_FONTS.map((f) => ({ value: f.id, label: f.label }))} hint="Display, page titles and section headings." />
            <Select
              label="Text font"
              value={draft.text}
              onValueChange={(v) => v && set({ text: v })}
              options={BRAND_FONTS.filter((f) => f.use === 'both').map((f) => ({ value: f.id, label: f.label }))}
              hint="Body, controls and captions. Every font here is self-hosted by the tokens package."
            />
            <Accordion appearance="flush" headingLevel={3} defaultValue={Object.keys(draft.radiusRoles).length ? ['advanced'] : []}>
              <AccordionItem value="advanced" title="Advanced" meta="Corner per role">
                <div className="nb-more">
                  {(Object.keys(ROLE_LABEL) as (keyof typeof ROLE_LABEL)[]).map((role) => (
                    <Select
                      key={role}
                      label={ROLE_LABEL[role]}
                      size="sm"
                      value={String(radiusOf(draft)[role])}
                      onValueChange={(v) => v && set({ radiusRoles: { ...draft.radiusRoles, [role]: Number(v) } })}
                      options={RADIUS_SCALE.map((n) => ({ value: String(n), label: `${n} px` }))}
                    />
                  ))}
                </div>
              </AccordionItem>
            </Accordion>
          </div>
          <div className="nb-stage">
            {previews}
            {contrastRow}
          </div>
        </div>
      )}

      {draft.step === 3 && (
        <div className="nb-body nb-review">
          <dl className="nb-summary">
            <div>
              <dt>Brand</dt>
              <dd>
                {draft.name.trim() || <span className="muted">No name yet</span>} <span className="mono muted">{slug}</span>
              </dd>
            </div>
            <div>
              <dt>Started from</dt>
              <dd>{brands.find((b) => b.slug === draft.from)?.name ?? draft.from}</dd>
            </div>
            <div>
              <dt>Colors</dt>
              <dd className="nb-summary-ramps">
                <Ramp swatches={plan.ramps.primary ?? []} mark={plan.actionStep} label="Primary" />
                <Ramp swatches={plan.ramps.neutral ?? []} label="Neutral" />
              </dd>
            </div>
            <div>
              <dt>Shape and type</dt>
              <dd>
                {RADIUS_PRESETS.find((p) => p.id === draft.radius)?.label} corners ({Object.values(radiusOf(draft)).join(' / ')} px), {BRAND_FONTS.find((f) => f.id === draft.heading)?.label} and {BRAND_FONTS.find((f) => f.id === draft.text)?.label}
              </dd>
            </div>
            <div>
              <dt>Contrast</dt>
              <dd>{contrastRow}</dd>
            </div>
            <div>
              <dt>Review</dt>
              <dd className="nb-tier">
                <Badge tone="neutral">Tier 3</Badge>
                <span>Needs design and tech approval. Starts as a draft branch.</span>
              </dd>
            </div>
          </dl>
          <div className="nb-jira">
            <Input label="Jira ticket" value={jira} onChange={(e) => setJira(e.currentTarget.value)} placeholder="DS-42" hint="Optional. Links this branch to the ticket in Jira." spellCheck={false} autoComplete="off" />
          </div>
          {(errors.length > 0 || slugIssues.length > 0) && (
            <Alert tone="danger" title="Fix these first">
              <ul className="nb-issues">
                {[...slugIssues, ...errors].slice(0, 5).map((i) => (
                  <li key={`${i.code}${i.path ?? ''}`}>{i.message}</li>
                ))}
              </ul>
            </Alert>
          )}
          {error && (
            <Alert tone="danger" title="The branch was not created">
              {error}
              {errorHref && (
                <>
                  {' '}
                  <Link href={errorHref} external>
                    Edit the token on GitHub
                  </Link>
                </>
              )}
            </Alert>
          )}
        </div>
      )}

      <div className="nb-actions">
        {draft.step === 0 ? (
          <Button variant="secondary" render={<a href="/studio/tokens/" />}>
            Cancel
          </Button>
        ) : (
          <Button variant="secondary" iconStart={ArrowLeft} onClick={() => go(draft.step - 1)}>
            Back
          </Button>
        )}
        {draft.step < 3 ? (
          // Distinct keys: the button under the pointer must not turn into "Connect GitHub" (data-gh-open) mid-click.
          <Button key="continue" variant="primary" iconEnd={ArrowRight} disabled={!canContinue} onClick={() => go(draft.step + 1)}>
            Continue
          </Button>
        ) : connected ? (
          <Button key="propose" variant="primary" iconStart={GitBranch} loading={busy} disabled={!ready} onClick={propose}>
            {VOCAB.createBranch}
          </Button>
        ) : (
          <Button key="connect" variant="primary" data-gh-open="">
            {ghAction('create the branch', signIn, rejected)}
          </Button>
        )}
        {draft.step === 3 && !ready && <span className="nb-actions-note">{plan.contrast.failing.length ? 'Creating the branch needs every contrast pair to pass.' : 'Fix the problems above to create the branch.'}</span>}
        {draft.step === 3 && ready && !connected && <span className="nb-actions-note">The draft stays in this browser until you create the branch.</span>}
      </div>
    </section>
  );
}

function Ramp({ swatches, mark, label }: { swatches: { step: number; hex: string }[]; mark?: number; label: string }) {
  return (
    <ol className="nb-ramp" aria-label={`${label} ramp`}>
      {swatches.map((s) => (
        <li key={s.step} data-mark={s.step === mark || undefined} title={`${s.step} ${s.hex}`}>
          <span className="nb-swatch" style={{ background: s.hex }} />
          <span className="sr-only">
            {s.step} {s.hex}
          </span>
        </li>
      ))}
    </ol>
  );
}

interface ColorFieldProps {
  label: string;
  description: string;
  value: string;
  onChange: (hex: string) => void;
  swatches: { step: number; hex: string }[];
  mark?: number;
  warning?: string | undefined;
}

function ColorField({ label, description, value, onChange, swatches, mark, warning }: ColorFieldProps) {
  const valid = normalizeHex(value);
  return (
    <fieldset className="nb-color">
      <legend className="nb-color-legend">{label}</legend>
      <p className="nb-color-desc">{description}</p>
      <div className="nb-color-row">
        <Input
          label="Hex"
          value={value}
          onValueChange={onChange}
          spellCheck={false}
          autoComplete="off"
          prefix={<span className="nb-chip" style={{ background: valid ?? 'transparent' }} aria-hidden="true" />}
          error={valid ? undefined : 'Use a 6-digit hex, for example 1F5F3A.'}
          className="nb-hex"
        />
        <Slider label="Hue" min={0} max={359} value={hueOf(value)} onValueChange={(v) => onChange(withHue(value, Array.isArray(v) ? v[0]! : v))} showValue className="nb-hue" />
      </div>
      <Ramp swatches={swatches} {...(mark !== undefined ? { mark } : {})} label={label} />
      {warning && <p className="nb-color-warn">{warning}</p>}
    </fieldset>
  );
}

function BrandPreview({ theme, vars, name }: { theme: 'light' | 'dark'; vars: Record<string, string>; name: string }) {
  return (
    <figure className="nb-pv">
      <figcaption className="nb-pv-cap">{theme === 'light' ? 'Light' : 'Dark'}</figcaption>
      {/* Real components, not interactive: inert keeps them out of the tab order and the step's controls count. */}
      <div className="nb-pv-stage" data-theme={theme} data-brand="bridge" data-density="comfortable" data-scope-fixed="" style={vars as CSSProperties} {...{ inert: '' }}>
        <div className="nb-pv-zone">
          <p className="nb-pv-title">{name}</p>
          <p className="nb-pv-muted">
            Muted text on a zone, with <Link href="#preview">a link</Link>.
          </p>
        </div>
        <div className="nb-pv-row">
          <Button variant="primary" size="sm">
            Publish tokens
          </Button>
          <Button variant="secondary" size="sm">
            Preview
          </Button>
        </div>
        <Input label="Token name" size="sm" defaultValue="color.text.muted" />
        <div className="nb-pv-row">
          <Switch label="Sync" size="sm" defaultChecked />
          <Checkbox label="Notify me" defaultChecked />
        </div>
        <div className="nb-pv-row">
          <Badge tone="success">Passing</Badge>
          <Badge tone="info">Tier 3</Badge>
          <Badge tone="neutral">Draft</Badge>
        </div>
      </div>
    </figure>
  );
}
