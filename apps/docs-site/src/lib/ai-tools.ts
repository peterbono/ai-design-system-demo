// The AI tools a person uses with Bridge: the Claude app (claude.ai or Claude Desktop, with the Bridge connector),
// Claude Code in a terminal, and GitHub Copilot in VS Code (agent mode, the Bridge MCP server from `bridge connect
// --tool copilot`). Asked once in onboarding (the "Your AI tools" step), changed in Settings > Your AI tools; a team
// admin sets the team default new members start from. The Continue panel of an exploration and the Start dialog show
// only these tools: one tool, no tabs; several, tabs limited to them.
//
// Storage: a Bridge account keeps the person's choice on the server (api/account `aiTools`); the team default lives
// with the team (api/entry `ai-tools`). This browser keeps a copy (`bridge.ai-tools`) for a viewer without an
// account (a GitHub session, a self-hosted Studio) and so the page paints the right tabs before the read answers.
// Pure, no DOM: covered by ai-tools.test.ts. The browser side is scripts/ai-tools.ts.

export type AiTool = 'claude-app' | 'claude-code' | 'copilot';

/** In the order every list shows them. */
export const AI_TOOLS: readonly AiTool[] = ['claude-app', 'claude-code', 'copilot'];

export const AI_TOOL_LABEL: Record<AiTool, string> = {
  'claude-app': 'Claude app',
  'claude-code': 'Claude Code in a terminal',
  copilot: 'GitHub Copilot in VS Code',
};

/** The short tab labels of the Continue panel. */
export const AI_TOOL_TAB: Record<AiTool, string> = {
  'claude-app': 'Claude app',
  'claude-code': 'Terminal',
  copilot: 'VS Code (Copilot)',
};

/** The line under each choice in the picker: where the person works. */
export const AI_TOOL_HINT: Record<AiTool, string> = {
  'claude-app': 'claude.ai or Claude Desktop, with the Bridge connector',
  'claude-code': 'Claude Code, from your project folder',
  copilot: 'Copilot Chat in agent mode, with the Bridge MCP server',
};

export const AI_TOOLS_WORDS = {
  title: 'Your AI tools',
  line: 'The AI you build with',
  lead: 'Pick the AI tools you use. Bridge shows the next step for those only.',
  settingsLead: 'Bridge shows the next step in these tools only. Only you see this choice.',
  teamTitle: 'Team default',
  teamLead: 'New members start from this choice until they pick their own.',
  teamNone: 'No default: new members see the Claude app and the terminal.',
  other: 'Use another AI tool?',
  save: 'Save',
  saved: 'Saved.',
  pickOne: 'Pick at least one.',
  /** The org policy GitHub documents for Copilot Business and Enterprise (off by default). */
  copilotPolicy: 'On Copilot Business or Enterprise, an admin turns on the "MCP servers in Copilot" policy first.',
} as const;

/** What a person never answered starts from: today's two Claude tabs. */
export const FALLBACK_TOOLS: readonly AiTool[] = ['claude-app', 'claude-code'];

/** A stored or posted list: the known tools, deduplicated, in AI_TOOLS order; null when nothing valid is there. */
export function parseAiTools(v: unknown): AiTool[] | null {
  const list = typeof v === 'string' ? safeJson(v) : v;
  if (!Array.isArray(list)) return null;
  const set = new Set(list.filter((x): x is AiTool => typeof x === 'string' && (AI_TOOLS as readonly string[]).includes(x)));
  const out = AI_TOOLS.filter((t) => set.has(t));
  return out.length ? out : null;
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export interface ToolsView {
  /** The tools the panel shows, in order. */
  tools: AiTool[];
  /** False while the person never answered: the panel offers "Use another AI tool?". */
  chosen: boolean;
}

/**
 * The tools a person sees. Their own choice first; never answered: a Bridge connection in their own Claude means the
 * Claude app, else the team default, else today's Claude app and Terminal.
 */
export function toolsFor(x: { mine: AiTool[] | null | undefined; teamDefault?: AiTool[] | null | undefined; claudeLink?: 'yes' | 'no' | 'unknown' | undefined }): ToolsView {
  if (x.mine?.length) return { tools: [...x.mine], chosen: true };
  if (x.claudeLink === 'yes') return { tools: ['claude-app'], chosen: false };
  if (x.teamDefault?.length) return { tools: [...x.teamDefault], chosen: false };
  return { tools: [...FALLBACK_TOOLS], chosen: false };
}

/** The tab to open: the one this viewer used last when it is still shown, else the first. */
export function tabFor(tools: readonly AiTool[], last: string | null | undefined): AiTool {
  return tools.find((t) => t === last) ?? tools[0] ?? 'claude-app';
}

/** "Claude app and GitHub Copilot in VS Code": the choice in one line (Settings, onboarding done). */
export function toolsSummary(tools: readonly AiTool[]): string {
  const words = tools.map((t) => AI_TOOL_LABEL[t]);
  return words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}` : (words[0] ?? '');
}
