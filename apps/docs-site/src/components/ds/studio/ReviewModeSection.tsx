// Settings > Members, for an admin: "Who looks after the design system?" (board R2, page Review flow). Three choices in
// DS ChoiceCards: one person (the design leads, picked in the role list above), shared with review, shared with no
// review. The server keeps it (api/invites set-review-mode, api/_lib/review-mode.ts) and reads it on every write.
import { useState } from 'react';
import { ChoiceCard, ChoiceCardGroup } from '@bridge-ds/react';
import { setReviewMode, type ReviewMode } from '../../../scripts/invites-api';

export const REVIEW_MODE_WORDS = {
  title: 'Who looks after the design system?',
  intro: 'They approve explorations before the developers.',
  one: {
    title: 'One person',
    text: 'The design leads approve every exploration. Make someone Design lead in the list above.',
  },
  shared: {
    title: 'Shared, with review',
    text: 'Another designer approves each exploration, never the author. Designers who join later review too.',
  },
  sharedNone: {
    title: 'Shared, no review',
    text: 'Explorations go to the developers once the PM agrees. A change to the design system itself still needs another designer.',
  },
  saved: 'Saved.',
} as const;

export default function ReviewModeSection({ repo, mode, demo, onSaved }: { repo: string; mode: ReviewMode; demo?: boolean; onSaved?: (m: ReviewMode) => void }) {
  const [value, setValue] = useState<ReviewMode>(mode);
  const [said, setSaid] = useState('');
  const [busy, setBusy] = useState(false);
  const pick = (v: string) => {
    const next = v as ReviewMode;
    if (next === value || busy) return;
    const was = value;
    setValue(next);
    if (demo) return;
    setBusy(true);
    setSaid('');
    setReviewMode(repo, next)
      .then(() => {
        setSaid(REVIEW_MODE_WORDS.saved);
        onSaved?.(next);
      })
      .catch((err: Error) => {
        setValue(was);
        setSaid(err.message);
      })
      .finally(() => setBusy(false));
  };
  return (
    <section className="mem-review" aria-labelledby="set-review">
      <div className="set-band-intro">
        <h2 id="set-review" className="set-h">
          {REVIEW_MODE_WORDS.title}
        </h2>
        <p className="set-intro">{REVIEW_MODE_WORDS.intro}</p>
      </div>
      <ChoiceCardGroup label={REVIEW_MODE_WORDS.title} hideLabel value={value} onValueChange={pick} disabled={busy} orientation="vertical">
        <ChoiceCard value="one" title={REVIEW_MODE_WORDS.one.title} description={REVIEW_MODE_WORDS.one.text} />
        <ChoiceCard value="shared" title={REVIEW_MODE_WORDS.shared.title} description={REVIEW_MODE_WORDS.shared.text} />
        <ChoiceCard value="shared-none" title={REVIEW_MODE_WORDS.sharedNone.title} description={REVIEW_MODE_WORDS.sharedNone.text} />
      </ChoiceCardGroup>
      <p className="mem-intro" role="status" aria-live="polite">
        {said}
      </p>
    </section>
  );
}
