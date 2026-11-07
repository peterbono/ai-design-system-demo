// Check the build (board R4), in the hand-off zone of a design copy exploration once the developers' version is ready:
// one sentence, who checks it and where each stands (the designer and the product manager, the design lead when the
// library changed), and for them Looks right or Needs changes. Needs changes asks what needs to change first: the build
// is off (back to the developer) or the design must change (back to the designer, a new round). Bridge's server signs
// it on the developers' work and keeps the "Design check" on it. Words: lib/build-check-view.ts.
import { useState, type FormEvent } from 'react';
import { Button, Radio, RadioGroup, Textarea } from '@bridge-ds/react';
import { BUILD_WORDS as W, type BuildCheckView, type BuildWhy } from '../../../lib/build-check-view';

export function BuildCheck({ v, say }: { v: BuildCheckView; say: (s: string) => void }) {
  const [asking, setAsking] = useState(false);
  const [why, setWhy] = useState<BuildWhy>('build');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<'looks-right' | 'changes' | null>(null);
  const send = (kind: 'looks-right' | 'changes') => {
    if (!v.onSay || (kind === 'changes' && !text.trim())) return;
    setBusy(kind);
    v.onSay({ kind, ...(kind === 'changes' ? { why, text: text.trim() } : {}) })
      .then((r) => {
        setAsking(false);
        setText('');
        if (r) say(r);
      })
      .catch((err: Error) => say(err.message))
      .finally(() => setBusy(null));
  };
  return (
    <div className="xp-build" aria-labelledby="xp-build-h">
      <h3 className="xp-h3" id="xp-build-h">
        {W.title}
      </h3>
      <p>{v.line}</p>
      <ul className="xp-build-rows">
        {v.rows.map((r) => (
          <li key={r.role} className="xp-build-row">
            <span className="xp-build-who">
              <strong>{r.name}</strong>
              {r.part && `, ${r.part}`}
            </span>
            <span className={`xp-build-state is-${r.state}`}>{r.stateLine}</span>
            {r.note && <span className="xp-build-note">{r.note}</span>}
          </li>
        ))}
      </ul>
      {v.onSay &&
        (asking ? (
          <form
            className="xp-lead-form"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              send('changes');
            }}
          >
            <RadioGroup label={W.whatChanges} value={why} onValueChange={(x) => setWhy(x === 'design' ? 'design' : 'build')}>
              <Radio value="build" label={W.buildOff} description={W.buildOffHint(v.builder)} />
              <Radio value="design" label={W.designChange} description={W.designChangeHint(v.designer)} />
            </RadioGroup>
            <Textarea label={W.note} rows={3} value={text} onChange={(e) => setText(e.target.value)} />
            <div className="xp-pm-acts">
              <Button type="submit" variant="inverse" size="md" loading={busy === 'changes'} disabled={!text.trim() || busy !== null}>
                {W.send}
              </Button>
              <Button type="button" variant="secondary" size="md" onClick={() => setAsking(false)}>
                {W.cancel}
              </Button>
            </div>
          </form>
        ) : (
          <div className="xp-pm-acts">
            <Button variant="inverse" size="md" loading={busy === 'looks-right'} disabled={busy !== null} onClick={() => send('looks-right')}>
              {W.looksRight}
            </Button>
            <Button variant="secondary" size="md" disabled={busy !== null} onClick={() => setAsking(true)}>
              {W.needsChanges}
            </Button>
          </div>
        ))}
      {v.note && <p className="xp-muted">{v.note}</p>}
    </div>
  );
}
