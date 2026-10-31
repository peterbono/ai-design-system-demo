// Library health: the three figures that open Studio Quality (contrast, adoption, guidance), the summary sentence
// above them, and the two ways to share them (a text for Slack or a slide, a PNG of the header drawn from an SVG).
// Pure: the page passes the dashboard numbers, the audit metrics and the guidance state in; library-health.test.ts
// covers the wording and the image.
//
// The figures used to open the Studio home (lib/overview-board healthFigures). Quality owns them now; each figure
// points at its own section further down the same page.

export type HealthId = 'contrast' | 'adoption' | 'guidance';

export interface HealthFigure {
  id: HealthId;
  /** The figure itself: "0 failing", "97.8%", "46 of 48". */
  value: string;
  /** What it counts: "contrast checks". */
  label: string;
  /** One quiet line: the trend or what is left. */
  detail: string;
  /** The same news as one plain sentence, for the shared summary. */
  sentence: string;
  /** Danger only when something fails. */
  tone: 'fail' | null;
  /** Its section on the Quality page. */
  href: string;
}

export interface AdoptionMetrics {
  dsComponentInstances: number;
  uiComponentInstances: number;
}

export interface HealthInput {
  contrast: { total: number; fail: number; brands: number };
  /** Per product: the current run and, when it exists, the run before the move to Bridge. */
  adoption: { now: AdoptionMetrics; before?: AdoptionMetrics | null }[];
  guidance: { total: number; reviewed: number; drafted: number; missing: number };
  /** What the earlier adoption value was: "before Bridge" (default), or "at the first audit" when runs are not a migration. */
  adoptionSince?: string;
}

/** Section ids on the Quality page, one per figure. */
export const HEALTH_SECTION: Record<HealthId, string> = { contrast: 'ql-contrast', adoption: 'ql-adoption', guidance: 'ql-guidance' };

const pct = (v: number) => `${Math.round(v * 10) / 10}%`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const capital = (s: string) => s.replace(/^./, (c) => c.toUpperCase());

/**
 * Component adoption across products: instances from Bridge over every UI component instance, summed over the
 * latest run of each product. The value before Bridge sums the earlier runs the same way, only when every product
 * has one. Null when no product has a report.
 */
export function combinedAdoption(apps: HealthInput['adoption']): { now: number; before: number | null; products: number } | null {
  const withData = apps.filter((a) => a.now.uiComponentInstances > 0);
  if (!withData.length) return null;
  const sum = (xs: AdoptionMetrics[]) => xs.reduce((s, m) => ({ ds: s.ds + m.dsComponentInstances, ui: s.ui + m.uiComponentInstances }), { ds: 0, ui: 0 });
  const now = sum(withData.map((a) => a.now));
  const befores = withData.map((a) => a.before).filter((b): b is AdoptionMetrics => Boolean(b && b.uiComponentInstances > 0));
  const before = befores.length === withData.length ? sum(befores) : null;
  return { now: (now.ds / now.ui) * 100, before: before ? (before.ds / before.ui) * 100 : null, products: withData.length };
}

/** The three figures, in reading order: what blocks first (contrast), then reach (adoption), then docs (guidance). */
export function healthFigures(input: HealthInput): HealthFigure[] {
  const { contrast, guidance } = input;
  const out: HealthFigure[] = [];
  const passing = contrast.total - contrast.fail;
  const where = `in ${plural(contrast.brands, 'brand')}, light and dark`;
  // Failures lead: "0 failing" says the gate holds, a number above 0 says what blocks the token build.
  out.push({
    id: 'contrast',
    value: `${contrast.fail} failing`,
    label: 'contrast checks',
    detail: contrast.fail ? `${passing} of ${contrast.total} pass. The token build waits until every pair passes.` : `${contrast.total} checked ${where}.`,
    sentence: contrast.fail
      ? `${contrast.fail} of ${contrast.total} contrast checks fail, so the token build waits until they pass.`
      : `All ${contrast.total} contrast checks pass ${where}.`,
    tone: contrast.fail ? 'fail' : null,
    href: `#${HEALTH_SECTION.contrast}`,
  });
  const a = combinedAdoption(input.adoption);
  if (a) {
    const across = plural(a.products, 'product');
    const since = input.adoptionSince ?? 'before Bridge';
    const up = a.before === null ? '' : `, up from ${pct(a.before)} ${since}`;
    out.push({
      id: 'adoption',
      value: pct(a.now),
      label: 'of components come from the design system',
      detail: a.before === null ? `Across ${across}.` : `Up from ${pct(a.before)} ${since}, across ${across}.`,
      sentence: `${pct(a.now)} of components in ${across} come from the design system${up}.`,
      tone: null,
      href: `#${HEALTH_SECTION.adoption}`,
    });
  }
  const left: string[] = [];
  if (guidance.drafted) left.push(`${guidance.drafted} drafted by Claude to review`);
  if (guidance.missing) left.push(`${guidance.missing} not written yet`);
  out.push({
    id: 'guidance',
    value: `${guidance.reviewed} of ${guidance.total}`,
    label: 'components have reviewed guidance',
    detail: left.length ? capital(`${left.join(', ')}.`) : 'Every component is documented.',
    sentence: `${guidance.reviewed} of ${guidance.total} components have reviewed usage guidance${left.length ? `: ${left.join(', ')}` : ''}.`,
    tone: null,
    href: `#${HEALTH_SECTION.guidance}`,
  });
  return out;
}

/**
 * The verdict above the figures, without repeating them: does anything block the library, and how many findings
 * need a look (open findings: fail or warn, the same list the page shows further down).
 */
export function healthSentence(contrastFail: number, openFindings: number, only?: string): string {
  if (contrastFail) return `Failing contrast checks block the token build. ${plural(openFindings, 'finding needs', 'findings need')} a fix.`;
  // One open finding: name it, so the action next to the sentence says what it acts on.
  if (openFindings === 1 && only) return `Nothing blocks the library. ${only.replace(/\.$/, '')}.`;
  if (openFindings) return `Nothing blocks the library. ${plural(openFindings, 'finding needs', 'findings need')} a look.`;
  return 'Nothing blocks the library and nothing needs you.';
}

/**
 * The text "Copy summary" puts on the clipboard: a title, one plain sentence per figure and the link, ready for
 * Slack or a slide. No markup beyond a dash per line, which both read as a list.
 */
export function qualityShareText(input: { figures: HealthFigure[]; sentence: string; url: string }): string {
  return ['Bridge library health', input.sentence, '', ...input.figures.map((f) => `- ${f.sentence}`), '', `Details: ${input.url}`].join('\n');
}

// ---------------------------------------------------------------------------------------------------------------
// The header as an image. The page reads its colors from the CSS custom properties, so the PNG follows the theme.

export interface ShareColors {
  /** Page paper: --color-bg-default. */
  page: string;
  /** The Harbor block: --color-bg-zone. */
  zone: string;
  /** Ink: --color-text-default. */
  ink: string;
  /** Secondary text: --color-text-muted. */
  muted: string;
  /** Card edges: --color-border-default. */
  line: string;
  /** A failing figure: --color-feedback-danger-text. */
  danger: string;
}

/** The custom property behind each color, read by the page with getComputedStyle. */
export const SHARE_COLOR_VARS: Record<keyof ShareColors, string> = {
  page: '--color-bg-default',
  zone: '--color-bg-zone',
  ink: '--color-text-default',
  muted: '--color-text-muted',
  line: '--color-border-default',
  danger: '--color-feedback-danger-text',
};

export const SHARE_IMAGE = { width: 1200, height: 630, file: 'bridge-quality.png' } as const;

export const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** Greedy word wrap on a character budget (the SVG has no text layout); a word longer than the budget keeps its line. */
export function wrapWords(text: string, max: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > max) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

const DISPLAY = "'Fraunces', Georgia, serif";
const SANS = "'Instrument Sans', system-ui, sans-serif";

/**
 * The Quality header as an SVG string (1200 by 630): a Harbor block with the title and the verdict, then one card per
 * figure on white, ink text, Fraunces for the title and the figures, Instrument Sans for the rest. `fontCss` carries
 * the @font-face rules with embedded fonts (an SVG drawn as an image cannot reach the page's fonts).
 */
export function qualitySvg(input: { figures: HealthFigure[]; sentence: string; colors: ShareColors; caption: string; fontCss?: string }): string {
  const { width: W, height: H } = SHARE_IMAGE;
  const { figures, sentence, colors: c, caption } = input;
  const pad = 64;
  const gap = 24;
  const n = Math.max(figures.length, 1);
  const cardW = (W - pad * 2 - gap * (n - 1)) / n;
  const cardY = 268;
  const cardH = 262;
  const t = (x: number, y: number, size: number, family: string, weight: number, fill: string, text: string) =>
    `<text x="${x}" y="${y}" font-family="${family}" font-size="${size}" font-weight="${weight}" fill="${fill}">${escapeXml(text)}</text>`;
  const cards = figures.map((f, i) => {
    const x = pad + i * (cardW + gap);
    const label = wrapWords(f.label, 26).slice(0, 2);
    const detail = wrapWords(f.detail, 34).slice(0, 3);
    const labelY = cardY + 118;
    const detailY = labelY + label.length * 30 + 14;
    return [
      `<rect x="${x}" y="${cardY}" width="${cardW}" height="${cardH}" rx="16" fill="${c.page}" stroke="${c.line}" stroke-width="2"/>`,
      t(x + 32, cardY + 78, 50, DISPLAY, 500, f.tone === 'fail' ? c.danger : c.ink, f.value),
      ...label.map((l, k) => t(x + 32, labelY + k * 30, 22, SANS, 600, c.ink, l)),
      ...detail.map((l, k) => t(x + 32, detailY + k * 26, 18, SANS, 400, c.muted, l)),
    ].join('');
  });
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    input.fontCss ? `<defs><style>${input.fontCss}</style></defs>` : '',
    `<rect width="${W}" height="${H}" fill="${c.page}"/>`,
    `<rect width="${W}" height="236" fill="${c.zone}"/>`,
    t(pad, 112, 50, DISPLAY, 500, c.ink, 'Library health'),
    t(pad, 168, 24, SANS, 600, c.ink, sentence),
    ...cards,
    t(pad, H - 40, 18, SANS, 400, c.muted, caption),
    '</svg>',
  ].join('');
}
