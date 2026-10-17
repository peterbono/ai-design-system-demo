import { describe, expect, it } from 'vitest';
import { acceptDocsText, anatomyLabel, classifyRisk, cssModuleClasses, docsPrompt, formatDocsJson, markClaudeDraft, missingProse, needsDocsReview, prefillDocs } from '../src/index';

const input = {
  name: 'Icon',
  description: 'Lucide icon at a token size.',
  props: [
    { name: 'icon', type: 'LucideIcon', required: true, description: 'Lucide icon component.' },
    { name: 'size', type: "'xs' | 'sm' | 'md'", required: false, defaultValue: "'md'" },
  ],
  tokens: ['--icon-size-md', '--icon-size-sm', '--icon-size-md'],
  cssClasses: ['icon', 'xs', 'iconOnly'],
  contrast: [
    { foreground: 'color.text.muted', background: 'color.bg.default', ratio: 5.1, min: 4.5 },
    { foreground: 'color.border.strong', background: 'color.bg.default', ratio: 3.2, min: 3 },
  ],
};

describe('docs pre-fill', () => {
  it('is deterministic and invents no prose', () => {
    const a = prefillDocs(input);
    expect(prefillDocs(input)).toEqual(a);
    expect(a.tokens).toEqual(['--icon-size-md', '--icon-size-sm']);
    expect(a.anatomy).toEqual({ icon: 'Icon', xs: 'Size xs', iconOnly: 'Icon only' });
    expect(a.propsTable).toContain('| `icon` (required) | `LucideIcon` |');
    expect(a.propsTable).toContain("`'md'`");
    expect(a.contrastNotes[0]).toMatch(/^color\.border\.strong on color\.bg\.default: 3\.20:1/);
    expect(a.draft.whenToUse).toEqual([]);
    expect(a.draft.summary).toBe('Lucide icon at a token size.');
    expect(a.missing).toContain('whenToUse');
    expect(a.changelogLine).toBe('Icon: usage guidance added.');
  });

  it('keeps existing prose and anatomy labels, and lists only the gaps', () => {
    const p = prefillDocs({ ...input, existing: { summary: 'Shows a glyph.', whenToUse: ['Next to a label.'], anatomy: { icon: 'The svg' } }, change: 'token icon.size.md changed' });
    expect(p.anatomy.icon).toBe('The svg');
    expect(p.draft.whenToUse).toEqual(['Next to a label.']);
    expect(p.missing).not.toContain('summary');
    expect(p.missing).not.toContain('whenToUse');
    expect(p.changelogLine).toBe('Icon: token icon.size.md changed.');
  });

  it('reads CSS module classes in order, skipping numbers and keyframes', () => {
    const css = '.root { opacity: 0.5; }\n@keyframes spin { from { opacity: 0; } to { opacity: 1; } }\n.root:hover, .iconOnly > .label { color: var(--x); }';
    expect(cssModuleClasses(css)).toEqual(['root', 'iconOnly', 'label']);
    expect(anatomyLabel('root')).toBe('Container');
    expect(anatomyLabel('is-open')).toBe('Is open');
  });

  it('builds a prompt with the facts, the rules and the conventions', () => {
    const prompt = docsPrompt(prefillDocs(input), { agents: 'AGENTS', voice: 'VOICE', example: '{}' });
    expect(prompt).toContain('Never invent');
    expect(prompt).toContain('no em dashes');
    expect(prompt).toContain('<voice>\nVOICE\n</voice>');
    expect(prompt).toContain('Tokens its stylesheet reads: --icon-size-md, --icon-size-sm');
  });
});

describe('docs review state', () => {
  it('marks, detects and accepts a Claude draft', () => {
    const d = markClaudeDraft(prefillDocs(input).draft);
    expect(needsDocsReview(d)).toBe(true);
    const text = acceptDocsText(formatDocsJson(d));
    const back = JSON.parse(text);
    expect(back.needsReview).toBe(false);
    expect(back.draftedBy).toBe('claude');
    expect(needsDocsReview(back)).toBe(false);
    expect(text.endsWith('}\n')).toBe(true);
    expect(Object.keys(back).slice(0, 2)).toEqual(['summary', 'whenToUse']);
  });

  it('counts empty arrays as missing prose', () => {
    expect(missingProse({ summary: 'x', whenToUse: [], dos: [{ title: 'a', text: 'b' }] })).toEqual(['whenToUse', 'whenNotToUse', 'donts', 'accessibility', 'contentGuidelines']);
  });

  it('a docs-only change is Tier 1', () => {
    expect(classifyRisk({ files: [{ path: 'packages/react/src/components/Icon/Icon.docs.json' }] }).tier).toBe(1);
  });
});
