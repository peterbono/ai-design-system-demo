// Settings, Library access: who reads the team's Library, for people without a GitHub account. A band like the others
// (title and one sentence, then a DS Card of rows). Two rows, each with its action on its own line (proximity):
//   Who reads the library  the choice in one phrase ("Anyone with a work email at acme.design") and one muted line;
//                          an admin's Change unfolds the three choices as a DS RadioGroup, and only the work email
//                          choice unfolds its domains field (progressive disclosure), then Save and Cancel.
//   Library link           the address, and Copy library link, so an admin shares it with the company.
// Everyone else reads the same rows with no Change. The sample team (Acme Design) shows its sample choice and Save opens
// the demo dialog, with no call; a site without the server says it is not available yet, never a fake save.
// Mounted by both Settings pages (pages/studio/settings, pages/team-shell/settings). Rules and words: lib/library-access.
import { useEffect, useId, useState, type FormEvent } from 'react';
import { Check, Copy } from 'lucide-react';
import { Alert, Button, Card, CardBody, Input, Radio, RadioGroup, Skeleton } from '@bridge-ds/react';
import { useCopy } from './TeamLink';
import { NoticeLine } from './MemberParts';
import type { Notice } from './members-state';
import { ACCESS_WORDS, MODE_ORDER, MODE_WORDS, parseDomainField, settingLabel, type AccessSetting, type LibraryMode } from '../../../lib/library-access';
import type { AccessData } from '../../../scripts/library-access-settings';
import '../../../styles/library-access.css';

type Load = { status: 'loading' } | { status: 'ready'; data: AccessData } | { status: 'error' };

function useAccessSettings() {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  useEffect(() => {
    let live = true;
    void import('../../../scripts/library-access-settings')
      .then(({ loadAccessSettings }) => loadAccessSettings())
      .then(
        (data) => live && setLoad({ status: 'ready', data }),
        () => live && setLoad({ status: 'error' }),
      );
    return () => {
      live = false;
    };
  }, []);
  const update = (setting: AccessSetting) => setLoad((l) => (l.status === 'ready' ? { status: 'ready', data: { ...l.data, setting, stored: true } } : l));
  return { load, update };
}

function Header({ intro }: { intro: string }) {
  return (
    <div className="set-band-intro">
      <h2 id="set-library-access" className="set-h">
        {ACCESS_WORDS.title}
      </h2>
      <p className="set-intro">{intro}</p>
    </div>
  );
}

function Editor({ data, onDone }: { data: AccessData; onDone: (saved: AccessSetting | null, notice: Notice | null) => void }) {
  const [mode, setMode] = useState<LibraryMode>(data.setting.mode);
  const [domains, setDomains] = useState(data.setting.domains.join(', '));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const id = useId();

  const save = async (e: FormEvent) => {
    e.preventDefault();
    let list: string[] = [];
    if (mode === 'email') {
      const parsed = parseDomainField(domains);
      if ('error' in parsed) return setError(parsed.error);
      list = parsed.domains;
    }
    setError(null);
    if (data.context === 'sample') {
      const { openMakeItYours } = await import('../../../scripts/demo-gate');
      await openMakeItYours();
      return onDone(null, null);
    }
    setSaving(true);
    try {
      const api = await import('../../../scripts/library-access-api');
      try {
        const saved = await api.saveLibraryAccess(data.repo, mode, list);
        onDone(saved, { tone: 'success', text: ACCESS_WORDS.saved(settingLabel(saved)) });
      } catch (err) {
        if (err instanceof api.AccessUnavailable) onDone(null, { tone: 'info', text: ACCESS_WORDS.unavailable });
        else setError(err instanceof Error && err.message ? err.message : 'Something went wrong. Try again in a minute.');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="lac-edit set-row-span" noValidate onSubmit={(e) => void save(e)} aria-labelledby={`${id}-label`}>
      <RadioGroup label={<span id={`${id}-label`}>{ACCESS_WORDS.who}</span>} hideLabel value={mode} onValueChange={(v) => setMode(v as LibraryMode)} className="lac-modes">
        {MODE_ORDER.map((m) => (
          <div key={m} className="lac-mode" data-selected={mode === m ? '' : undefined}>
            <Radio value={m} label={m === 'email' ? `${MODE_WORDS.email.label}...` : MODE_WORDS[m].label} description={MODE_WORDS[m].help} />
            {m === 'email' && mode === 'email' && (
              <Input
                label={ACCESS_WORDS.domains}
                hint={ACCESS_WORDS.domainsHint}
                placeholder={ACCESS_WORDS.domainsPlaceholder}
                autoComplete="off"
                spellCheck={false}
                value={domains}
                onValueChange={(v) => {
                  setDomains(v);
                  if (error) setError(null);
                }}
                error={error ?? undefined}
                className="lac-domains mono"
                autoFocus
              />
            )}
          </div>
        ))}
      </RadioGroup>
      {error && mode !== 'email' && (
        <p className="lac-error" role="alert">
          {error}
        </p>
      )}
      <div className="lac-savebar">
        <Button variant="primary" type="submit" loading={saving}>
          {ACCESS_WORDS.save}
        </Button>
        <Button variant="secondary" onClick={() => onDone(null, null)}>
          {ACCESS_WORDS.cancel}
        </Button>
        <span className="set-quiet lac-note">{ACCESS_WORDS.revokes}</span>
      </div>
    </form>
  );
}

function LinkRow({ link }: { link: string }) {
  const { copied, said, copy } = useCopy();
  return (
    <div className="set-row">
      <p className="set-row-label">{ACCESS_WORDS.link}</p>
      <div className="set-row-value">
        <span className="mono lac-link">{link}</span>
        <p className="sr-only" role="status" aria-live="polite">
          {said}
        </p>
        {said && !copied && <p className="set-row-help">{said}</p>}
      </div>
      <div className="set-row-action">
        <Button variant="secondary" data-density="compact" className="lac-action" iconStart={copied ? Check : Copy} onClick={() => void copy(link, ACCESS_WORDS.copied)}>
          {copied ? ACCESS_WORDS.copied : ACCESS_WORDS.copy}
        </Button>
      </div>
    </div>
  );
}

export default function LibraryAccessSection() {
  const { load, update } = useAccessSettings();
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  if (load.status === 'loading')
    return (
      <>
        <Header intro={ACCESS_WORDS.intro} />
        <div className="set-band-body" aria-busy="true" aria-label="Reading who reads the library">
          <Skeleton height="var(--size-20)" />
        </div>
      </>
    );
  if (load.status === 'error')
    return (
      <>
        <Header intro={ACCESS_WORDS.intro} />
        <div className="set-band-body">
          <Alert tone="danger">Bridge could not read who reads this library. Try again in a minute.</Alert>
        </div>
      </>
    );
  const data = load.data;
  if (data.context === 'none')
    return (
      <>
        <Header intro={ACCESS_WORDS.intro} />
        <div className="set-band-body">
          <p className="set-quiet">Connect your design system first. Then choose who reads its library.</p>
        </div>
      </>
    );

  const canEdit = data.canManage && data.available;
  const s = data.setting;
  const publicNote = data.isPrivate === false && s.mode !== 'anyone';
  return (
    <>
      <Header intro={data.canManage ? ACCESS_WORDS.intro : `${ACCESS_WORDS.intro} ${ACCESS_WORDS.readOnly}`} />
      <div className="set-band-body">
        {data.context === 'real' && data.canManage && !data.available && <Alert tone="info">{ACCESS_WORDS.unavailable}</Alert>}
        <Card aria-labelledby="set-library-access">
          <CardBody>
            <div className="set-rows">
              <div className="set-row">
                <p className="set-row-label">{ACCESS_WORDS.who}</p>
                {editing ? (
                  <Editor
                    data={data}
                    onDone={(saved, n) => {
                      if (saved) update(saved);
                      setEditing(false);
                      setNotice(n);
                    }}
                  />
                ) : (
                  <>
                    <div className="set-row-value">
                      <p className="set-who">{settingLabel(s)}</p>
                      <p className="set-row-help">{MODE_WORDS[s.mode].help}</p>
                      {publicNote && <p className="set-row-help">{ACCESS_WORDS.publicRepo}</p>}
                    </div>
                    <div className="set-row-action">
                      {canEdit && (
                        <Button
                          variant="secondary"
                          data-density="compact"
                          className="lac-action"
                          onClick={() => {
                            setNotice(null);
                            setEditing(true);
                          }}
                        >
                          {ACCESS_WORDS.change}
                        </Button>
                      )}
                    </div>
                  </>
                )}
              </div>
              <LinkRow link={data.link} />
            </div>
            <NoticeLine notice={notice} />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
