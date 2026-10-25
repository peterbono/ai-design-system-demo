// Settings, Claude: the team connects its own Claude, so Bridge can fix differences between Figma and the code for it
// (api/claude, docs/FIGMA-FIXES.md "Claude runs it for the team"). A band like the others: title and one sentence, then
// a DS Card with one row.
//   Not connected  "Not connected." and one muted line; an admin's Connect Claude unfolds the key field (a password
//                  input: the key is never shown), then Connect and Cancel.
//   Connected      "Connected, added by Dana Kim on Oct 25, 2026." and who pays for it; an admin has Disconnect.
// Everyone else reads the same row with no action, and who can connect it by name (SettingsParts AdminOnlyNote words,
// BR-20: no disabled control). The sample team shows the row and its Connect opens the demo dialog, with no call; a
// site without the server says it is not available yet. The key goes to this site's server once and never comes back.
// Mounted by both Settings pages (pages/studio/settings, pages/team-shell/settings). Words: lib/claude-connect.ts.
import { useEffect, useState, type FormEvent } from 'react';
import { Alert, Button, Card, CardBody, Input, Skeleton } from '@bridge-ds/react';
import { NoticeLine } from './MemberParts';
import { DevFold } from './SettingsParts';
import { adminNames, useTeamPeople, type Notice } from './members-state';
import { adminOnlyText } from '../../../lib/settings-view';
import { CLAUDE_CONNECT_WORDS as W, cleanKey, connectedDate, looksLikeKey, type ClaudeConnectionView } from '../../../lib/claude-connect';
import { accessContext, type AccessContext } from '../../../lib/library-access';
import { repoContext } from '../../../scripts/repo-context';

type Load = { status: 'loading' } | { status: 'ready'; context: AccessContext; repo: string; view: ClaudeConnectionView } | { status: 'error' };

const noRepoPage = () => typeof document !== 'undefined' && document.documentElement.hasAttribute('data-no-repo');
const NOT_AVAILABLE: ClaudeConnectionView = { available: false, connected: false, canManage: false };

function useConnection() {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  useEffect(() => {
    let live = true;
    const ctx = repoContext();
    const repo = `${ctx.owner}/${ctx.repo}`;
    const context = accessContext(noRepoPage() ? null : repo, noRepoPage());
    if (context !== 'real') {
      setLoad({ status: 'ready', context, repo, view: { available: true, connected: false, canManage: context === 'sample' } });
      return;
    }
    void import('../../../scripts/claude-api')
      .then(async (api) => {
        try {
          return await api.readClaudeConnection(repo);
        } catch (e) {
          if (e instanceof api.ClaudeUnavailable) return NOT_AVAILABLE;
          // Signed out, or not on this team: the row reads as not connected, with no action.
          if (e instanceof api.ClaudeApiError && (e.status === 401 || e.status === 403)) return NOT_AVAILABLE;
          throw e;
        }
      })
      .then(
        (view) => live && setLoad({ status: 'ready', context, repo, view }),
        () => live && setLoad({ status: 'error' }),
      );
    return () => {
      live = false;
    };
  }, []);
  const update = (v: Partial<ClaudeConnectionView>) => setLoad((l) => (l.status === 'ready' ? { ...l, view: { ...l.view, ...v } } : l));
  return { load, update };
}

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

function ConnectForm({ repo, sample, onDone }: { repo: string; sample: boolean; onDone: (v: Partial<ClaudeConnectionView> | null, n: Notice | null) => void }) {
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const k = cleanKey(key);
    if (!looksLikeKey(k)) return setError('This does not look like an Anthropic API key. Copy it again from the Claude Console: it starts with sk-ant-.');
    setError(null);
    if (sample) {
      const { openMakeItYours } = await import('../../../scripts/demo-gate');
      await openMakeItYours();
      return onDone(null, null);
    }
    setSaving(true);
    try {
      const api = await import('../../../scripts/claude-api');
      try {
        const r = await api.connectClaude(repo, k);
        setKey('');
        onDone(r, { tone: 'success', text: W.saved });
      } catch (err) {
        if (err instanceof api.ClaudeUnavailable) onDone(null, { tone: 'info', text: W.unavailable });
        else setError(err instanceof Error && err.message ? err.message : 'Something went wrong. Try again in a minute.');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="set-row-value set-row-span" noValidate onSubmit={(e) => void submit(e)} aria-label={W.connect}>
      <Input
        label={W.keyLabel}
        hint={W.keyHint}
        type="password"
        autoComplete="off"
        spellCheck={false}
        value={key}
        onValueChange={(v) => {
          setKey(v);
          if (error) setError(null);
        }}
        error={error ?? undefined}
        className="mono"
        autoFocus
      />
      <div className="set-rules-actions">
        <Button variant="primary" type="submit" loading={saving}>
          {W.connectSubmit}
        </Button>
        <Button variant="secondary" onClick={() => onDone(null, null)}>
          {W.cancel}
        </Button>
      </div>
    </form>
  );
}

export default function ClaudeSection() {
  const { load, update } = useConnection();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const people = useTeamPeople();

  if (load.status === 'loading')
    return (
      <>
        <Header />
        <div className="set-band-body" aria-busy="true" aria-label="Reading your Claude connection">
          <Skeleton height="var(--size-20)" />
        </div>
      </>
    );
  if (load.status === 'error')
    return (
      <>
        <Header />
        <div className="set-band-body">
          <Alert tone="danger">{W.readError}</Alert>
        </div>
      </>
    );
  if (load.context === 'none')
    return (
      <>
        <Header />
        <div className="set-band-body">
          <p className="set-quiet">{W.noRepo}</p>
        </div>
      </>
    );

  const { view, repo, context } = load;
  const sample = context === 'sample';
  const canAct = view.canManage && view.available;

  const disconnect = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const api = await import('../../../scripts/claude-api');
      await api.disconnectClaude(repo);
      update({ connected: false, addedBy: undefined, at: undefined });
      setNotice({ tone: 'success', text: W.removed });
    } catch (err) {
      setNotice({ tone: 'danger', text: err instanceof Error && err.message && err.name === 'ClaudeApiError' ? err.message : 'Something went wrong. Try again in a minute.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Header />
      <div className="set-band-body">
        {context === 'real' && view.canManage && !view.available && <Alert tone="info">{W.unavailable}</Alert>}
        <Card>
          <CardBody>
            <div className="set-rows">
              <div className="set-row">
                <p className="set-row-label">{W.row}</p>
                {editing ? (
                  <ConnectForm
                    repo={repo}
                    sample={sample}
                    onDone={(v, n) => {
                      if (v) update(v);
                      setEditing(false);
                      setNotice(n);
                    }}
                  />
                ) : (
                  <>
                    <div className="set-row-value">
                      <p>{view.connected ? W.connected(view.addedBy ?? '', connectedDate(view.at ?? '')) : W.notConnected}</p>
                      <p className="set-row-help">{view.connected ? W.billed : sample ? W.sample : W.notConnectedHelp}</p>
                      {!view.canManage && context === 'real' && <p className="set-row-help">{adminOnlyText(adminNames(people), W.adminDoes)}</p>}
                    </div>
                    {canAct && (
                      <div className="set-row-action">
                        {view.connected ? (
                          <Button variant="secondary" data-density="compact" loading={busy} onClick={() => void disconnect()}>
                            {W.disconnect}
                          </Button>
                        ) : (
                          <Button
                            variant="secondary"
                            data-density="compact"
                            onClick={() => {
                              setNotice(null);
                              setEditing(true);
                            }}
                          >
                            {W.connect}
                          </Button>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
            <NoticeLine notice={notice} />
            <DevFold
              facts={[
                { term: 'Key', value: "The team's Anthropic API key, encrypted on the Bridge server (AES-256-GCM, BRIDGE_SECRETS_KEY). Never sent back to a browser." },
                { term: 'Used for', value: 'Fixing differences between Figma and the code: claude-sonnet-5-5, up to 3 rounds per component, a draft pull request on figma-fixes.json.' },
                { term: 'API', value: '/api/claude', code: true },
              ]}
            />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
