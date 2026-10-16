// A tiny stand-in for ESLint's RuleTester: parse with @babel/parser (ESTree + JSX + TypeScript), set parents,
// walk, call the rule's visitors, collect reports and apply fixes. Enough to test rules without ESLint installed.
import { parse } from '@babel/parser';
import type { Node, RuleContext, RuleModule } from '../src/index';

export interface Report {
  messageId: string;
  message: string;
  line: number;
  fix?: { range: [number, number]; text: string };
}

export function runRule(rule: RuleModule, code: string, options: unknown[] = [], settings: RuleContext['settings'] = {}): { reports: Report[]; output: string } {
  const ast = parse(code, { sourceType: 'module', plugins: ['estree', 'jsx', 'typescript'], ranges: true }).program as unknown as Node;
  const reports: Report[] = [];
  const context: RuleContext = {
    options,
    settings,
    cwd: process.cwd(),
    report(d) {
      const msg = rule.meta.messages[d.messageId]!.replace(/\{\{(\w+)\}\}/g, (_, k: string) => d.data?.[k] ?? '');
      const fix = d.fix?.({ replaceText: (n: Node, text: string) => ({ range: n.range!, text }) }) as Report['fix'];
      reports.push({ messageId: d.messageId, message: msg, line: (d.node as unknown as { loc: { start: { line: number } } }).loc.start.line, ...(fix ? { fix } : {}) });
    },
  };
  const visitors = rule.create(context);
  const walk = (n: Node, parent?: Node) => {
    if (parent) n.parent = parent;
    visitors[n.type]?.(n);
    for (const [k, v] of Object.entries(n)) {
      if (k === 'parent' || k === 'loc' || k === 'range') continue;
      if (Array.isArray(v)) v.forEach((c) => c && typeof c === 'object' && typeof (c as Node).type === 'string' && walk(c as Node, n));
      else if (v && typeof v === 'object' && typeof (v as Node).type === 'string') walk(v as Node, n);
    }
  };
  walk(ast);
  let output = code;
  for (const f of reports.map((r) => r.fix).filter((x): x is NonNullable<Report['fix']> => Boolean(x)).sort((a, b) => b.range[0] - a.range[0])) output = output.slice(0, f.range[0]) + f.text + output.slice(f.range[1]);
  return { reports, output };
}
