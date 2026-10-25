// Settings, Claude: use Bridge inside the team's own Claude (the hosted MCP connector, api/mcp). A band like the others:
// title and one sentence, then a DS Card:
//   Connector address  the two steps (Add custom connector with this address; sign in with Bridge), the address with
//                      Copy address on its row, and one line for Claude Team and Enterprise Owners.
//   In Claude          "Connected in Claude by Dana Kim, last used Oct 25, 2026." or "Not connected yet."; each
//                      connection on its own line with Remove for its owner or a team admin.
// A "For developers" fold: Claude Code with the hosted address, and the local MCP server with npx. The sample team shows
// the steps and no connection; nothing is ever called for it. Words: lib/claude-connector.ts.
// Below it, the measure of the team's components (MeasureSetting): what lets Claude fix what differs in Figma.
import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button, Card, CardBody } from '@bridge-ds/react';
import { useCopy } from './TeamLink';
import { NoticeLine } from './MemberParts';
import { Code, DevFold } from './SettingsParts';
import MeasureSetting from './MeasureSetting';
import type { Notice } from './members-state';
import { CONNECTOR_WORDS as W, connectionSentence, connectorUrl, developerSnippets, type Connection } from '../../../lib/claude-connector';
import { accessContext, type AccessContext } from '../../../lib/library-access';
import { repoContext } from '../../../scripts/repo-context';

const noRepoPage = () => typeof document !== 'undefined' && document.documentElement.hasAttribute('data-no-repo');

function Header() {
  return (
    <div className="set-band-intro">
      <h2 id="set-claude" className="set-h">
        {W.title}
      </h2>
      <p className="set-intro">{W.intro}</p>
    </div>
  );
}

export default function ClaudeConnector() {
  const [context, setContext] = useState<AccessContext | null>(null);
  const [repo, setRepo] = useState('');
  const [list, setList] = useState<Connection[] | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const { copied, said, copy } = useCopy();
  const url = typeof location === 'undefined' ? '/mcp' : connectorUrl(location.origin);

  useEffect(() => {
    let live = true;
    const ctx = repoContext();
    const r = `${ctx.owner}/${ctx.repo}`;
    const c = accessContext(noRepoPage() ? null : r, noRepoPage());
    setRepo(r);
    setContext(c);
    if (c !== 'real') return;
    void import('../../../scripts/connector-api')
      .then((api) => api.listConnections(r))
      .then(
        (x) => {
          if (!live) return;
          setList(x.connections);
          setCanManage(x.canManage);
        },
        () => live && setList(null),
      );
    return () => {
      live = false;
    };
  }, []);

  const remove = async (c: Connection) => {
    setNotice(null);
    try {
      const api = await import('../../../scripts/connector-api');
      await api.removeConnection(repo, c.id);
      setList((l) => (l ? l.filter((x) => x.id !== c.id) : l));
      setNotice({ tone: 'success', text: W.removed });
    } catch (e) {
      setNotice({ tone: 'danger', text: e instanceof Error && e.message ? e.message : 'Something went wrong. Try again in a minute.' });
    }
  };

  if (context === 'none')
    return (
      <>
        <Header />
        <div className="set-band-body">
          <p className="set-quiet">{W.noRepo}</p>
        </div>
      </>
    );
  const snippets = developerSnippets(url, repo || 'owner/name');
  return (
    <>
      <Header />
      <div className="set-band-body">
        <Card>
          <CardBody>
            <div className="set-rows">
              <div className="set-row">
                <p className="set-row-label">{W.address}</p>
                <div className="set-row-value set-row-span">
                  <ol className="set-steps">
                    <li>{W.step1}</li>
                    <li>{W.step2}</li>
                  </ol>
                  <p className="set-connection">
                    <span className="mono set-address">{url}</span>
                    <Button variant="secondary" data-density="compact" iconStart={copied ? Check : Copy} onClick={() => void copy(url, W.copied)}>
                      {copied ? W.copied : W.copy}
                    </Button>
                  </p>
                  <p className="sr-only" role="status" aria-live="polite">
                    {said}
                  </p>
                  {said && !copied && <p className="set-row-help">{said}</p>}
                  <p className="set-row-help">{W.orgAdmins}</p>
                </div>
              </div>
              <div className="set-row">
                <p className="set-row-label">{W.status}</p>
                <div className="set-row-value">
                  <p>{context === 'sample' ? W.sample : connectionSentence(list ?? [])}</p>
                  {(list ?? []).map((c) => (
                    <p className="set-row-help set-connection" key={c.id}>
                      <span>
                        {c.by}, {c.client}
                      </span>
                      {(c.mine || canManage) && (
                        <Button variant="ghost" data-density="compact" onClick={() => void remove(c)}>
                          {W.remove}
                        </Button>
                      )}
                    </p>
                  ))}
                </div>
              </div>
            </div>
            <NoticeLine notice={notice} />
            <DevFold
              facts={[
                { term: 'Claude Code', value: snippets.claudeCode, code: true },
                { term: 'Claude Desktop', value: 'Settings, Connectors, Add custom connector: the same address (Pro, Max, Team or Enterprise).' },
                { term: 'Local MCP server', value: <pre className="mono set-snippet">{snippets.local}</pre> },
                { term: 'Endpoint', value: <Code>{url}</Code> },
              ]}
            />
          </CardBody>
        </Card>
        {context && <MeasureSetting context={context} />}
      </div>
    </>
  );
}
