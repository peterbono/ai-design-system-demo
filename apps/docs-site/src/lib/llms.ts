// /llms.txt: the same data as the human pages, flattened to plain text for agents.
// Single source, two outputs: if a token or a rule changes, both the HTML and this file change on the next build.
import { loadComponents } from './components';
import { contrastPairs } from './contrast';
import { agentRules } from './governance';
import { stripMd } from './markdown';
import { GITHUB_URL, today } from './repo';
import { groupUsage } from './sources';
import { loadTokens, primitivesOf } from './tokens';

export function buildLlmsTxt(): string {
  const { semantic } = loadTokens();
  const components = loadComponents();
  const out: string[] = [];
  const push = (...l: string[]) => out.push(...l);

  push(
    '# AI design system demo',
    '',
    '> A small design system run as code: W3C DTCG tokens (primitives + light/dark semantic aliases) and four React',
    '> components (Button, Input, Badge, Card) that read CSS variables only. The repo is the source of truth, not Figma.',
    '',
    `Generated from the repository on ${today()}. Source: ${GITHUB_URL}`,
    'Human version of the same content: the docs site pages /foundations/, /components/, /governance/.',
    '',
    '## Rules for agents (from AGENTS.md)',
    '',
  );
  for (const group of agentRules()) {
    push(`### ${group.heading}`, '', ...group.rules.map((r) => `- ${stripMd(r.original)}`), '');
  }

  push('## Semantic tokens', '', 'Use these in components for color, elevation and focus. Format: CSS variable | light | dark.', '');
  const groups = [...new Set(semantic.map((s) => s.group))];
  for (const g of groups) {
    push(`### ${g}`, '');
    const note = groupUsage(g);
    if (note) push(note, '');
    for (const s of semantic.filter((x) => x.group === g)) {
      const fmt = (m: 'light' | 'dark') => {
        const v = s.modes[m];
        return v.alias ? `${v.alias} (${v.css})` : v.css;
      };
      const desc = s.description ? ` | ${s.description}` : '';
      push(`- \`var(${s.cssVar})\` | ${fmt('light')} | ${fmt('dark')}${desc}`);
    }
    push('');
  }

  push('## Scales (primitives, same in both themes)', '');
  const scale = (title: string, prefix: string) => {
    push(`- ${title}: ${primitivesOf(prefix).map((p) => `\`${p.cssVar}\` ${p.css}`).join(', ')}`);
  };
  scale('Spacing', 'space');
  scale('Radius', 'radius');
  scale('Border width', 'border.width');
  scale('Font size', 'font.size');
  scale('Font weight', 'font.weight');
  scale('Line height', 'font.line-height');
  push('', 'If a value is not in a scale, do not invent one: propose a token in the PR.', '');

  const failing = contrastPairs().flatMap((p) =>
    (['light', 'dark'] as const)
      .filter((m) => !p.modes[m].aa)
      .map((m) => `- ${p.fg} on ${p.bg} (${p.usage}, ${m}): ${p.modes[m].ratio}:1`),
  );
  push('## Contrast', '', 'Pairs are listed in packages/tokens/src/contrast-pairs.json and checked against WCAG AA (4.5:1 text, 3:1 UI).');
  push(failing.length ? 'Pairs currently below AA (do not copy these combinations into new places):' : 'All listed pairs pass AA in both themes.', ...failing, '');

  push('## Components', '');
  for (const c of components) {
    push(`### ${c.name}`, '');
    if (c.docs?.summary) push(c.docs.summary, '');
    push(`Import: \`import { ${[c.name, ...c.subcomponents].join(', ')} } from '@demo-ds/react'\``);
    if (c.inherits) push(`Accepts all native <${c.inherits}> attributes${c.omitted.length ? ` except ${c.omitted.join(', ')}` : ''}.`);
    if (c.props.length) {
      push('Props:');
      for (const p of c.props) {
        push(
          `- ${p.name}${p.required ? '' : '?'}: ${p.type}${p.defaultValue ? ` = ${p.defaultValue}` : ''}${p.description ? `. ${p.description}` : ''}`,
        );
      }
    }
    if (c.docs) {
      push('When to use:', ...c.docs.whenToUse.map((x) => `- ${x}`));
      push('When not to use:', ...c.docs.whenNotToUse.map((x) => `- ${x}`));
      push('Do:', ...c.docs.dos.map((x) => `- ${x.title}. ${x.text}`));
      push("Don't:", ...c.docs.donts.map((x) => `- ${x.title}. ${x.text}`));
      push('Accessibility:', ...c.docs.accessibility.map((x) => `- ${x}`));
    }
    push(`Tokens used: ${c.tokensUsed.map((t) => t.name).join(', ')}`, '');
  }

  push(
    '## Optional',
    '',
    `- [AGENTS.md](${GITHUB_URL}/blob/main/AGENTS.md): full agent instructions`,
    `- [GOVERNANCE.md](${GITHUB_URL}/blob/main/docs/GOVERNANCE.md): risk tiers and review gates`,
    `- [Token sources](${GITHUB_URL}/tree/main/packages/tokens/src): DTCG JSON`,
    '',
  );
  return out.join('\n');
}
