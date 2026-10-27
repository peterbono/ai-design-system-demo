// Library > Use > Agents, for any design system: its llms.txt, the Bridge MCP server pointed at its repository, the
// bridge CLI and the safety model. Bridge's own page (pages/agents.astro) renders it at build time from its own
// llms.txt; a team's Library in the browser, from the llms.txt the team published next to its snapshot.
import { CodeBlock, Icon, Link } from '@bridge-ds/react';
import { siteIcon } from '../../../../brand/site-icons';
import { inline } from '../../../../lib/markdown';
import { llmsStats } from '../../../../lib/library/use-pages';
import AgentToolsTable from '../../AgentToolsTable';
import InlineMd from '../../InlineMd';
import { LibraryHeader } from '../FoundationParts';
import type { LibraryData } from '../library-data';

export const AGENTS_PAGE = { title: 'Agents', art: 'guide' } as const;

const ASKS = [
  'Which token should this card background use in dark mode?',
  'Darken muted text in the light theme and show me the contrast impact first.',
  'Review the newest open change for the design owner.',
  "Audit this component's CSS for hardcoded values.",
];

const CLI = [
  { cmd: 'bridge init', text: 'Detects your token folder, tiers and modes, writes bridge.config.json and .mcp.json, prints the Claude Desktop snippet.' },
  { cmd: 'bridge check', text: 'Validates tokens and runs the contrast gate. Use it in CI: exit 0 ok, 1 failures, 2 setup error.' },
  { cmd: 'bridge tokens <query>', text: 'Searches tokens by words, CSS variable or value.' },
  { cmd: 'bridge diff <base>', text: 'Designer-readable token diff against a git ref, with alias impact, contrast and the risk tier.' },
  { cmd: 'bridge propose --title "..." --set path=value', text: 'Turns token edits into a commit on a new local bridge/* branch. Blocked when a check fails.' },
  { cmd: 'bridge history [token]', text: 'Token history: versions and merged changes, or every change of one token, with who, when and why.' },
  { cmd: 'bridge revert <pr|commit> --dry-run', text: 'Plans the undo of a merged token change against today: conflicts with later changes shown. Without --dry-run, a new local branch.' },
  { cmd: 'bridge impact --plan', text: 'Visual impact: which stories and app screens a change touches. Without --plan, screenshots both refs and pixel-diffs them (needs Chrome).' },
  {
    cmd: 'bridge audit <path>',
    text: 'Design system adoption in product code (CSS, TSX, Astro, Vue, Svelte): token and component adoption, hardcoded values with the closest token, native elements to replace, top files. --fix for exact CSS matches.',
  },
];

export default function AgentsView({ data }: { data: LibraryData }) {
  const use = data.extras.use;
  const bridge = use?.bridge;
  const llms = use?.llms;
  const lines = llms ? llms.text.split('\n').length : 0;
  const stats = llms ? llmsStats(llms.text) : [];
  // The server runs from npm, on a GitHub repository (this Library's, for a team) or on a local folder.
  const mcp = bridge?.mcpPackage ?? '@bridge-ds/mcp';
  const repo = data.team ? `${data.team.owner}/${data.team.repo}` : 'owner/name';
  const npx = ['-y', mcp];
  const claudeCode = `claude mcp add bridge -s user -- npx ${npx.join(' ')} --repo ${repo}`;
  const desktopRemote = JSON.stringify({ mcpServers: { bridge: { command: 'npx', args: [...npx, '--repo', repo] } } }, null, 2);
  const claudeCodeLocal = `claude mcp add bridge -- npx ${npx.join(' ')} --root /abs/path/to/your-ds`;
  const projectJson = JSON.stringify({ mcpServers: { bridge: { command: 'npx', args: [...npx, '--root', '.'] } } }, null, 2);
  const desktopLocal = JSON.stringify({ mcpServers: { bridge: { command: 'npx', args: [...npx, '--root', '/abs/path/to/your-ds'] } } }, null, 2);
  const tools = bridge?.tools ?? [];
  const prompts = bridge?.prompts ?? [];
  return (
    <div>
      <LibraryHeader title={AGENTS_PAGE.title} art={AGENTS_PAGE.art}>
        Three ways in, all generated from the same token files, components and rules. <Link href="#mcp">The MCP server</Link> gives Claude Code, Claude Desktop or any MCP client a structured
        view and proposes changes as pull requests. <Link href="#cli">The bridge CLI</Link> does the same from a terminal or CI. <Link href="#llms">llms.txt</Link> is the whole documentation as
        plain text, for any agent that can read a URL.
      </LibraryHeader>

      <ul className="cx-facts" aria-label="At a glance">
        <li>
          <Icon icon={siteIcon('check')} size="sm" className="icon" /> Free, source available
        </li>
        <li>
          <Icon icon={siteIcon('check')} size="sm" className="icon" /> Local: no account, no backend
        </li>
        <li>
          <Icon icon={siteIcon('check')} size="sm" className="icon" /> Your repo, your Claude, your GitHub token
        </li>
        <li>
          <Icon icon={siteIcon('check')} size="sm" className="icon" /> Any DTCG token repo
        </li>
      </ul>

      <h2 id="llms">llms.txt</h2>
      {llms ? (
        <>
          <p>
            One source, two outputs. The pages you read and the file an agent reads come from the same build, so they cannot disagree. <Link href={llms.href}>{data.team ? 'llms.txt' : '/llms.txt'}</Link>{' '}
            holds the agent rules from <code>AGENTS.md</code>, every semantic token with its light and dark value, the scales, failing contrast pairs, and each component's props and usage rules.
          </p>
          <dl className="stat-strip" aria-label={data.team ? 'What llms.txt contains, counted from the file' : 'What /llms.txt contains, counted from the generated file'}>
            {stats.map((s) => (
              <div key={s.label}>
                <dt>{s.label}</dt>
                <dd className="num">{s.value}</dd>
              </div>
            ))}
          </dl>
          <ul className="why-list">
            <li>
              <span className="why-icon" aria-hidden="true">
                <Icon icon={siteIcon('layers')} size="md" className="icon" />
              </span>
              <p>Agents follow short, structured context better than long prose style guides. Values come from the token files, not from a copy.</p>
            </li>
            <li>
              <span className="why-icon" aria-hidden="true">
                <Icon icon={siteIcon('shield')} size="md" className="icon" />
              </span>
              <p>The hard rules are not only in this text: CI blocks raw colors and shadows, so an agent that ignores the file still cannot merge.</p>
            </li>
          </ul>
          <details className="llms-preview">
            <summary>Preview llms.txt ({lines} lines)</summary>
            <CodeBlock className="cx-block" code={llms.text} label="llms.txt" />
            <p className="small">
              <Link href={llms.href}>Open raw llms.txt</Link>
            </p>
          </details>
        </>
      ) : (
        <p className="muted">
          {llms === null ? 'No llms.txt published yet.' : 'Reading llms.txt.'} <code>bridge snapshot</code> writes one next to the snapshot: the agent rules, every semantic token and each
          component's props and usage rules, as plain text.
        </p>
      )}

      <h2 id="mcp">MCP server</h2>
      <p>
        Tokens resolved in every brand, theme and density, the contrast gate, components with their props and usage docs, and the agent rules. Claude builds UI with real tokens and proposes token
        changes as pull requests your design and tech owners review.
      </p>

      <h3 id="claude-code">1. Claude Code</h3>
      <p>Connect Claude to your design system repository on GitHub. No clone, nothing to build, and read-only until you add a token:</p>
      <CodeBlock className="cx-block" code={claudeCode} label="Claude Code command" />
      <p>
        To let Claude open changes for review, add <code>-e GITHUB_TOKEN=github_pat_...</code> before <code>--</code>: a fine-grained token limited to that one repository, with contents and pull
        requests read and write. Without a token, GitHub allows 60 requests an hour.
      </p>

      <h3 id="claude-desktop">2. Claude Desktop</h3>
      <p>
        In Settings, Developer, Edit config, add this to <code>claude_desktop_config.json</code>, then restart Claude Desktop:
      </p>
      <CodeBlock className="cx-block" code={desktopRemote} label="claude_desktop_config.json" />
      <p className="small muted">
        For the token, add <code>{'"env": { "GITHUB_TOKEN": "github_pat_..." }'}</code> next to <code>args</code>.
      </p>

      <details className="cx-details">
        <summary>Work on a local folder instead of a GitHub repository</summary>
        <p>
          Pass <code>--root</code> with the path to your design system checkout. Claude Code:
        </p>
        <CodeBlock className="cx-block" code={claudeCodeLocal} label="Claude Code command for a local folder" />
        <p>
          Or share it with your team through git: a project <code>.mcp.json</code> at the repository root. Claude Code asks you to approve project servers the first time.
        </p>
        <CodeBlock className="cx-block" code={projectJson} label="Project .mcp.json" />
        <p>Claude Desktop:</p>
        <CodeBlock className="cx-block" code={desktopLocal} label="Claude Desktop configuration for a local folder" />
      </details>
      <p className="small muted">
        Other MCP clients work the same way over stdio: <code>npx -y {mcp} --repo owner/name</code> (add <code>--ref</code> for another branch) or <code>--root &lt;dir&gt;</code>. Options can
        also come from <code>BRIDGE_REPO</code>, <code>BRIDGE_REF</code>, <code>BRIDGE_ROOT</code> and <code>GITHUB_TOKEN</code>.
      </p>

      {tools.length > 0 && (
        <>
          <h3 id="tools">What Claude can do: {tools.length} tools</h3>
          <AgentToolsTable tools={tools.map((t) => ({ name: t.name, use: inline(t.use) }))} />
        </>
      )}
      {prompts.length > 0 && (
        <>
          <h3>Prompts</h3>
          <p className="small">
            Slash commands in Claude Code, for example <code>/mcp__bridge__audit-ui-for-tokens</code>.
          </p>
          <ul className="cx-list">
            {prompts.map((p) => (
              <li key={p.name}>
                <code>{p.name}</code>: <InlineMd md={p.text} />
              </li>
            ))}
          </ul>
        </>
      )}
      <h3>Things to ask</h3>
      <ul className="cx-list">
        {ASKS.map((a) => (
          <li key={a}>{a}</li>
        ))}
      </ul>

      <h2 id="cli">bridge CLI</h2>
      <p>
        The same checks and proposals from a terminal or CI, from npm with nothing to install first. Run it in your design system repository: every command below is{' '}
        <code>npx {bridge?.cliPackage ?? '@bridge-ds/cli'} &lt;command&gt;</code>, starting with <code>check</code>.
      </p>
      <CodeBlock className="cx-block" code={`npx ${bridge?.cliPackage ?? '@bridge-ds/cli'} check`} label="Run bridge init" />
      <dl className="cx-cli">
        {CLI.map((c) => (
          <div key={c.cmd}>
            <dt>
              <code>{c.cmd}</code>
            </dt>
            <dd>{c.text}</dd>
          </div>
        ))}
        <div>
          <dt>
            <code>bridge mcp</code>
          </dt>
          <dd>Starts the MCP server on stdio, same as npx {mcp}.</dd>
        </div>
      </dl>

      {bridge && bridge.safety.length > 0 && (
        <>
          <h2 id="safety">Safety model</h2>
          <ul className="why-list">
            {bridge.safety.map((s, i) => (
              <li key={i}>
                <span className="why-icon" aria-hidden="true">
                  <Icon icon={siteIcon('shield')} size="md" className="icon" />
                </span>
                <p>
                  {s.title && <strong>{s.title}. </strong>}
                  <InlineMd md={s.text} />
                </p>
              </li>
            ))}
          </ul>
        </>
      )}

      {bridge && (
        <p className="small muted">
          Full guide: <Link href={bridge.aiDoc.href}>{bridge.aiDoc.label}</Link>. Source and license: <Link href={bridge.repoUrl}>GitHub</Link>, MIT.
        </p>
      )}
    </div>
  );
}
