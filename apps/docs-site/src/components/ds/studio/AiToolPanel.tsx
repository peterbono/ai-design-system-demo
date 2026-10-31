// The next step in the person's own AI tools (rules and words: lib/ai-tools.ts; storage: scripts/ai-tools.ts), shared
// by the exploration page (the Continue panel) and the Start dialog:
//   - ToolPanel: "Paste this in <tool>", the line and its copy button, and under it the one command the tool needs
//     once in the repository. One tool chosen: no tabs at all. Several: tabs limited to them, the last one this
//     viewer used open. Never answered: the inferred tools and a quiet "Use another AI tool?" that opens the choice.
//   - ToolAction: the tool's button. Claude app: opens a new Claude conversation with the line in it (and copies it),
//     after the connect steps while the viewer's own Claude has no Bridge (ConnectClaudeDialog, claudeLink 'no').
//     Terminal: "Continue in Claude" copies the line. VS Code: "Copy for Copilot" copies it for Copilot Chat.
//   - AiToolsChoice and AiToolsDialog: the multi-select itself, for onboarding, Settings and the quiet link.
import { useEffect, useState, type ReactNode } from 'react';
import { Copy as CopyIcon } from 'lucide-react';
import { Avatar, Button, Checkbox, CheckboxGroup, Dialog, DialogContent, IconButton, SegmentedControl, Tooltip } from '@bridge-ds/react';
import { AI_TOOL_HINT, AI_TOOL_LABEL, AI_TOOL_TAB, AI_TOOLS, AI_TOOLS_WORDS, parseAiTools, tabFor, toolsFor, type AiTool, type ToolsView } from '../../../lib/ai-tools';
import { ConnectClaudeDialog } from './ConnectClaudeDialog';
import { AI_TOOLS_EVENT, knownAiTools, lastAiTab, readAiTools, rememberAiTab, saveMyAiTools } from '../../../scripts/ai-tools';
// The panel's styles (.xp-paste*, .xp-continue, the connect dialog): the Start dialog uses them outside the exploration page.
import '../../../styles/exploration-page.css';

export type ToolLines = Record<AiTool, string>;
/** The one command a tool needs once in the repository (bridge connect), when it needs one here. */
export type ToolSetup = Partial<Record<AiTool, { label: string; command: string } | null>>;
export type ClaudeLink = 'yes' | 'no' | 'unknown';

/** A new Claude conversation with the line already in the message box (claude.ai/new?q=). */
export const claudeNewUrl = (line: string) => `https://claude.ai/new?q=${encodeURIComponent(line)}`;

export const TOOL_SAID: Record<AiTool, { copied: string; opened?: string }> = {
  'claude-app': { copied: 'Copied. Paste it in Claude.', opened: 'Opened in Claude with the line ready. Press Enter to start.' },
  'claude-code': { copied: 'Copied. Paste it in your terminal, in the project folder.' },
  copilot: { copied: 'Copied. Paste it in Copilot Chat in VS Code, in Agent mode.' },
};
const COPY_FAILED = 'Select the line and copy it.';

/** "Paste this in Claude" / "Run this in your terminal" / "Paste this in Copilot Chat". */
const PASTE_HEAD: Record<AiTool, string> = {
  'claude-app': 'Paste this in Claude',
  'claude-code': 'Run this in your terminal',
  copilot: 'Paste this in Copilot Chat',
};

/** A tab's words; on a phone "VS Code (Copilot)" reads "VS Code" (the line above it already says Copilot Chat). */
function tabLabel(t: AiTool): ReactNode {
  if (t !== 'copilot') return AI_TOOL_TAB[t];
  return (
    <>
      VS Code<span className="xp-tab-more"> (Copilot)</span>
    </>
  );
}

/** The button's words for one tool. */
export const ACTION_LABEL: Record<AiTool, string> = {
  'claude-app': 'Continue in Claude',
  'claude-code': 'Continue in Claude',
  copilot: 'Copy for Copilot',
};

export function ClaudeGlyph({ size = 'xs' }: { size?: 'xs' | 'sm' }) {
  return <Avatar kind="agent" brand="claude" name="Claude" size={size} decorative className="xp-claude" />;
}

/**
 * The tools this viewer sees and the open tab. Paints from this browser first (no flash of the wrong tabs), then
 * from the server; follows a change made anywhere on the page (`bridge:ai-tools`).
 */
export function useAiTools(claudeLink?: ClaudeLink) {
  const [state, setState] = useState<{ mine: AiTool[] | null; teamDefault: AiTool[] | null }>({ mine: null, teamDefault: null });
  const [last, setLast] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const known = knownAiTools();
    setState({ mine: known.mine, teamDefault: known.teamDefault });
    setLast(lastAiTab());
    const load = (fresh: boolean) =>
      void readAiTools(fresh).then((r) => live && setState({ mine: r.mine, teamDefault: r.teamDefault }));
    load(false);
    const on = () => load(true);
    document.addEventListener(AI_TOOLS_EVENT, on);
    return () => {
      live = false;
      document.removeEventListener(AI_TOOLS_EVENT, on);
    };
  }, []);
  const view: ToolsView = toolsFor({ ...state, claudeLink });
  const tab = tabFor(view.tools, last);
  const setTab = (t: AiTool) => {
    setLast(t);
    rememberAiTab(t);
  };
  return { view, tab, setTab, mine: state.mine };
}

/** The multi-select: Claude app, Claude Code in a terminal, GitHub Copilot in VS Code. */
export function AiToolsChoice({ value, onChange, error, label = 'AI tools you use', hideLabel = false }: { value: AiTool[]; onChange: (v: AiTool[]) => void; error?: ReactNode; label?: string; hideLabel?: boolean }) {
  return (
    <CheckboxGroup label={label} hideLabel={hideLabel} value={value} onValueChange={(v) => onChange(parseAiTools(v) ?? [])} error={error}>
      {AI_TOOLS.map((t) => (
        <Checkbox key={t} value={t} label={AI_TOOL_LABEL[t]} description={AI_TOOL_HINT[t]} />
      ))}
    </CheckboxGroup>
  );
}

/** "Use another AI tool?": the choice in a dialog, saved for this person. */
export function AiToolsDialog({ open, onOpenChange, initial }: { open: boolean; onOpenChange: (o: boolean) => void; initial: AiTool[] }) {
  const [value, setValue] = useState<AiTool[]>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setValue(initial);
      setError(null);
    }
  }, [open]);
  const save = async () => {
    if (!value.length) return setError(AI_TOOLS_WORDS.pickOne);
    setBusy(true);
    try {
      await saveMyAiTools(value);
      onOpenChange(false);
    } catch (err) {
      setError((err as Error).message || 'Bridge did not answer. Try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <DialogContent
          title={AI_TOOLS_WORDS.title}
          description={AI_TOOLS_WORDS.lead}
          size="sm"
          footer={
            <Button onClick={() => void save()} loading={busy}>
              {AI_TOOLS_WORDS.save}
            </Button>
          }
        >
          <AiToolsChoice value={value} onChange={setValue} error={error} hideLabel />
        </DialogContent>
      )}
    </Dialog>
  );
}

/** The line to paste in the open tool, its tabs when the person uses several, and the once-only command. */
export function ToolPanel({ tools, tab, setTab, chosen, lines, setup, onCopy, say }: { tools: AiTool[]; tab: AiTool; setTab: (t: AiTool) => void; chosen: boolean; lines: ToolLines; setup?: ToolSetup; onCopy: (text: string) => Promise<void>; say: (s: string) => void }) {
  const [choosing, setChoosing] = useState(false);
  const line = lines[tab];
  const once = setup?.[tab] ?? null;
  const copy = () => onCopy(line).then(() => say(TOOL_SAID[tab].copied), () => say(COPY_FAILED));
  return (
    <div className="xp-paste">
      <div className="xp-paste-head">
        <span className="xp-muted" id="xp-paste-label">
          {PASTE_HEAD[tab]}
        </span>
        {tools.length > 1 && (
          <SegmentedControl size="sm" label="Your AI tool" value={tab} onValueChange={(v) => setTab(v as AiTool)} items={tools.map((t) => ({ value: t, label: tabLabel(t) }))} />
        )}
      </div>
      <div className="xp-paste-body">
        <code className="xp-line" id="xp-line">
          {line}
        </code>
        <Tooltip content="Copy">
          <IconButton icon={CopyIcon} label="Copy the line" variant="secondary" size="sm" onClick={() => void copy()} />
        </Tooltip>
      </div>
      {once && (
        <p className="xp-paste-setup">
          <span className="xp-muted">{once.label}</span> <code className="xp-mono">{once.command}</code>
        </p>
      )}
      {!chosen && (
        <p className="xp-paste-other">
          <Button variant="link" size="sm" onClick={() => setChoosing(true)} aria-haspopup="dialog">
            {AI_TOOLS_WORDS.other}
          </Button>
        </p>
      )}
      <AiToolsDialog open={choosing} onOpenChange={setChoosing} initial={tools} />
    </div>
  );
}

/**
 * The tool's button. The Claude app opens Claude (the connector gate first while the viewer's Claude has no Bridge);
 * the terminal and Copilot copy the line and say where to paste it.
 */
export function ToolAction({ tool, line, onCopy, say, variant, claudeLink, connectorAddress, onClaudeConnected, children, size = 'lg' }: { tool: AiTool; line: string; onCopy: (text: string) => Promise<void>; say: (s: string) => void; variant: 'primary' | 'secondary'; claudeLink?: ClaudeLink; connectorAddress?: string; onClaudeConnected?: () => void; children?: string; size?: 'md' | 'lg' }) {
  const [asking, setAsking] = useState(false);
  const label = children ?? ACTION_LABEL[tool];
  const open = tool === 'claude-app';
  const copy = () => onCopy(line).then(() => !open && say(TOOL_SAID[tool].copied), () => !open && say(COPY_FAILED));
  const glyph = tool === 'copilot' ? null : <ClaudeGlyph />;
  if (open && claudeLink === 'no')
    return (
      <>
        <Button variant={variant} size={size} className="xp-continue" aria-haspopup="dialog" onClick={() => setAsking(true)}>
          {glyph}
          {label}
        </Button>
        <ConnectClaudeDialog
          open={asking}
          onOpenChange={setAsking}
          address={connectorAddress ?? '/mcp'}
          continueHref={claudeNewUrl(line)}
          onCopy={onCopy}
          onContinue={() => {
            void copy();
            say(TOOL_SAID['claude-app'].opened!);
            onClaudeConnected?.();
          }}
        />
      </>
    );
  if (!open)
    return (
      <Button variant={variant} size={size} className="xp-continue" iconStart={tool === 'copilot' ? CopyIcon : undefined} onClick={() => void copy()}>
        {glyph}
        {label}
      </Button>
    );
  return (
    <Button
      variant={variant}
      size={size}
      className="xp-continue"
      render={<a href={claudeNewUrl(line)} target="_blank" rel="noopener" />}
      onClick={() => {
        void copy();
        say(TOOL_SAID['claude-app'].opened!);
      }}
    >
      {glyph}
      {label}
    </Button>
  );
}
