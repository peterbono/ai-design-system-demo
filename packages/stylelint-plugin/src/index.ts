// @bridge/stylelint-plugin: bridge/use-tokens. Raw values in product CSS where a design token exists are
// reported with the token to use; values equal to a token are replaced with var(--token) by --fix.
import stylelint, { type Rule } from 'stylelint';
import { isSafeFix, scanCssValue, type Confidence, type FindingCategory } from '@bridge/core/audit';
import { findDesignSystemRoot, loadDesignSystem } from '@bridge/core/node';

const {
  createPlugin,
  utils: { report, ruleMessages, validateOptions },
} = stylelint;

export const ruleName = 'bridge/use-tokens';

export interface UseTokensOptions {
  /** Design system repo with bridge.config.json. Default: BRIDGE_DS, else the nearest one above the working directory. */
  designSystem?: string;
  /** Report a value only when a token is at least this close. Default "medium". */
  minConfidence?: Confidence;
  /** Categories to check. Default: all. */
  categories?: FindingCategory[];
  /** Properties to skip (strings or /regex/ strings). */
  ignoreProperties?: string[];
}

export const messages = ruleMessages(ruleName, {
  rejected: (value: string, category: string, token: string, tokenValue: string, level: string) =>
    level === 'exact' ? `Use var(${token}) instead of ${value}: it is the same ${category} (${tokenValue}).` : `Use a token instead of the raw ${category} ${value}: closest is var(${token}) (${tokenValue}, ${level} match).`,
});

const meta = { url: 'https://github.com/peterbono/ai-design-system-demo/tree/main/packages/stylelint-plugin#bridgeuse-tokens', fixable: true };
const RANK: Record<Confidence, number> = { exact: 3, high: 2, medium: 1, low: 0 };
const isString = (x: unknown) => typeof x === 'string';

const rule: Rule<boolean, UseTokensOptions> = (primary, secondary) => (root, result) => {
  const valid = validateOptions(
    result,
    ruleName,
    { actual: primary, possible: [true, false] },
    { actual: secondary, possible: { designSystem: [isString], minConfidence: ['exact', 'high', 'medium', 'low'], categories: [isString], ignoreProperties: [isString] }, optional: true },
  );
  if (!valid || !primary) return;
  const dsRoot = secondary?.designSystem ?? process.env.BRIDGE_DS ?? findDesignSystemRoot(root.source?.input.file ?? process.cwd()) ?? findDesignSystemRoot(process.cwd());
  let ds;
  try {
    if (!dsRoot) throw new Error('no bridge.config.json found');
    ds = loadDesignSystem(dsRoot).index;
  } catch (e) {
    result.warn(`${ruleName}: ${(e as Error).message}. Set the "designSystem" option to your design system repo.`, { stylelintType: 'invalidOption' });
    return;
  }
  const min = RANK[secondary?.minConfidence ?? 'medium'];
  const ignore = (secondary?.ignoreProperties ?? []).map((p) => (p.startsWith('/') && p.lastIndexOf('/') > 0 ? new RegExp(p.slice(1, p.lastIndexOf('/')), p.slice(p.lastIndexOf('/') + 1)) : new RegExp(`^${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)));

  root.walkDecls((decl) => {
    if (ignore.some((r) => r.test(decl.prop))) return;
    const scan = scanCssValue(decl.prop, decl.value);
    const found = scan.hits
      .filter((hit) => !secondary?.categories || secondary.categories.includes(hit.category))
      .map((hit) => ({ hit, s: ds.suggest(hit.category, hit.text, decl.prop.toLowerCase()) }))
      .filter((x): x is { hit: typeof x.hit; s: NonNullable<typeof x.s> } => Boolean(x.s) && RANK[x.s!.level] >= min);
    const safe = found.filter((x) => isSafeFix(x.hit, x.s));
    // One fix rewrites every exact match of the declaration (offsets stay valid), whichever warning triggers it.
    let fixed = false;
    const fix = () => {
      if (fixed) return;
      fixed = true;
      let v = decl.value;
      for (const { hit, s } of [...safe].sort((a, b) => b.hit.index - a.hit.index)) v = v.slice(0, hit.index) + `var(${s.cssVar})` + v.slice(hit.index + hit.text.length);
      decl.value = v;
    };
    const offset = decl.prop.length + (decl.raws.between?.length ?? 1);
    for (const x of found) {
      report({
        result,
        ruleName,
        message: messages.rejected(x.hit.text, x.hit.category, x.s.cssVar, x.s.value, x.s.level),
        node: decl,
        index: offset + x.hit.index,
        endIndex: offset + x.hit.index + x.hit.text.length,
        ...(safe.includes(x) ? { fix } : {}),
      });
    }
  });
};

rule.ruleName = ruleName;
rule.messages = messages;
rule.meta = meta;

const plugin = createPlugin(ruleName, rule);
export default plugin;
