// The AI / MCP page reads docs/AI.md, so the tool list and the safety model on the site are the ones shipped
// with the server (packages/mcp) and cannot drift from them.
import { bullets, inline, section, table } from './markdown';
import { readText } from './repo';

export const AI_DOC = 'docs/AI.md';
export const MCP_README = 'packages/mcp/README.md';

export interface McpTool {
  name: string;
  /** HTML (inline Markdown rendered). */
  use: string;
}

export function mcpTools(): McpTool[] {
  const t = table(section(readText(AI_DOC), 'What Claude can do'));
  return (t?.rows ?? []).map(([name, use]) => ({ name: (name ?? '').replace(/`/g, ''), use: inline(use ?? '') }));
}

/** Safety model bullets as { title, text } HTML, from "**Title.** text". */
export function safetyModel(): { title: string; text: string }[] {
  return bullets(section(readText(AI_DOC), 'Safety model')).map((b) => {
    const m = b.match(/^\*\*([^*]+)\*\*\s*(.*)$/);
    return m ? { title: m[1]!.replace(/\.$/, ''), text: inline(m[2]!) } : { title: '', text: inline(b) };
  });
}

/** Prompt names and descriptions ("- `name`: text"). */
export function mcpPrompts(): { name: string; text: string }[] {
  return bullets(section(readText(AI_DOC), 'What Claude can do'))
    .map((b) => b.match(/^`([^`]+)`:\s*(.*)$/))
    .filter((m): m is RegExpMatchArray => !!m && !m[1]!.startsWith('bridge_'))
    .map((m) => ({ name: m[1]!, text: inline(m[2]!) }));
}
