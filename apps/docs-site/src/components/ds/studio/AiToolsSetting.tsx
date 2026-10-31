// Settings, Your AI tools (lib/ai-tools.ts, scripts/ai-tools.ts): the AI tools this person uses, a personal choice
// (kept with their Bridge account, else in this browser). The Continue panel of an exploration and the Start dialog
// show only these tools. An admin of a real team, signed in with a Bridge account, also sets the team default new
// members start from until they pick their own. The same card on the self-hosted Settings and on a team's Settings.
import { useEffect, useState } from 'react';
import { Button, Card, CardBody } from '@bridge-ds/react';
import { AI_TOOLS_WORDS, FALLBACK_TOOLS, toolsSummary, type AiTool } from '../../../lib/ai-tools';
import { AiToolsChoice } from './AiToolPanel';

function useSaver(save: (v: AiTool[]) => Promise<unknown>, allowEmpty = false) {
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState('');
  const [error, setError] = useState<string | null>(null);
  const run = async (v: AiTool[]) => {
    setSaid('');
    setError(null);
    if (!v.length && !allowEmpty) return setError(AI_TOOLS_WORDS.pickOne);
    setBusy(true);
    try {
      await save(v);
      setSaid(AI_TOOLS_WORDS.saved);
    } catch (err) {
      setError((err as Error).message || 'Bridge did not answer. Try again.');
    } finally {
      setBusy(false);
    }
  };
  return { busy, said, error, run };
}

export default function AiToolsSetting() {
  const [mine, setMine] = useState<AiTool[]>([...FALLBACK_TOOLS]);
  const [teamDefault, setTeamDefault] = useState<AiTool[]>([]);
  const [team, setTeam] = useState<string | null>(null);
  const [canSetDefault, setCanSetDefault] = useState(false);
  const me = useSaver((v) => import('../../../scripts/ai-tools').then((m) => m.saveMyAiTools(v)));
  const def = useSaver((v) => import('../../../scripts/ai-tools').then((m) => (team ? m.saveTeamAiTools(team, v.length ? v : null) : null)), true);

  useEffect(() => {
    let live = true;
    let admin = false;
    let account = false;
    const decide = () => live && setCanSetDefault(admin && account);
    void import('../../../scripts/ai-tools').then(async (m) => {
      const known = m.knownAiTools();
      if (live && known.mine) setMine(known.mine);
      const r = await m.readAiTools();
      if (!live) return;
      setTeam(r.team);
      if (r.mine) setMine(r.mine);
      else if (r.teamDefault) setMine(r.teamDefault);
      setTeamDefault(r.teamDefault ?? []);
      account = r.account && Boolean(r.team);
      decide();
    });
    void import('../../../scripts/github-session').then(({ onAccess }) =>
      onAccess((a) => {
        admin = Boolean(a?.admin || a?.repoAdmin);
        decide();
      }),
    );
    return () => {
      live = false;
    };
  }, []);

  return (
    <Card>
      <CardBody>
        <div className="set-rows">
          <div className="set-row set-row-stack">
            <AiToolsChoice label="AI tools you use" value={mine} onChange={setMine} error={me.error} />
            <p className="set-row-help">{AI_TOOLS_WORDS.settingsLead}</p>
            {mine.includes('copilot') && <p className="set-row-help">{AI_TOOLS_WORDS.copilotPolicy}</p>}
            <div className="set-row-actions">
              <Button variant="secondary" onClick={() => void me.run(mine)} loading={me.busy}>
                {AI_TOOLS_WORDS.save}
              </Button>
              <span role="status" className="set-row-help">
                {me.said}
              </span>
            </div>
          </div>
          {canSetDefault && (
            <div className="set-row set-row-stack">
              <AiToolsChoice label={AI_TOOLS_WORDS.teamTitle} value={teamDefault} onChange={setTeamDefault} error={def.error} />
              <p className="set-row-help">{teamDefault.length ? `${AI_TOOLS_WORDS.teamLead} Now: ${toolsSummary(teamDefault)}.` : AI_TOOLS_WORDS.teamNone}</p>
              <div className="set-row-actions">
                <Button variant="secondary" onClick={() => void def.run(teamDefault)} loading={def.busy}>
                  Save team default
                </Button>
                <span role="status" className="set-row-help">
                  {def.said}
                </span>
              </div>
            </div>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
