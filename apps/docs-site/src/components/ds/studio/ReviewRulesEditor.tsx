// Settings > Review rules on a team shell, editable by an admin with GitHub access (lib/settings-view
// canEditReviewRules, docs/GOVERNANCE.md): who checks the look, who checks the code, who adds a change to the library
// (governance.rights) and whether leads publish small changes without review (governance.leadsPublishTier1). Saving
// proposes the bridge.config.json change with the admin's own token (scripts/roles.ts proposeReviewRules): a Tier 3
// change, reviewed before it applies, never written to the default branch. Everyone else reads the rules (the
// children) and who changes them.
import { useEffect, useState, type ReactNode } from 'react';
import { Alert, Button, Link, SegmentedControl, Switch } from '@bridge-ds/react';
import { DEFAULT_RIGHTS, type Owners, type Rights, type VisualImpactMode } from '@bridge-ds/core';
import { CHOICE_LABEL, choiceOf, groupsOf, type RightChoice } from '../../../lib/roles-view';
import { canEditReviewRules, RIGHT_PLAIN, RULES_NEED_REVIEW } from '../../../lib/settings-view';
import { studioHref } from '../../../lib/team-path';

const RIGHTS = ['approveDesign', 'approveTech', 'ship'] as const;
const CHOICES = (['design', 'tech', 'both'] as RightChoice[]).map((c) => ({ value: c, label: CHOICE_LABEL[c] }));

export interface ReviewRulesEditorProps {
  owners: Owners;
  rights: Rights | null;
  leadsPublishTier1: boolean;
  visualMode: VisualImpactMode;
  prefix?: string;
  protectedBranches?: string[];
  /** The read-only rules, shown while not editing. */
  children: ReactNode;
}

export default function ReviewRulesEditor(p: ReviewRulesEditorProps) {
  const initial = Object.fromEntries(RIGHTS.map((r) => [r, choiceOf(p.rights?.[r] ?? DEFAULT_RIGHTS[r])])) as Record<(typeof RIGHTS)[number], RightChoice>;
  const [can, setCan] = useState<boolean | null>(null);
  const [editing, setEditing] = useState(false);
  const [picks, setPicks] = useState(initial);
  const [leads, setLeads] = useState(p.leadsPublishTier1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState<{ number: number } | null>(null);

  useEffect(() => {
    let live = true;
    void import('../../../scripts/github-session').then(({ onAccess }) => onAccess((a) => live && setCan(canEditReviewRules(a))));
    return () => {
      live = false;
    };
  }, []);

  const changed = leads !== p.leadsPublishTier1 || RIGHTS.some((r) => picks[r] !== initial[r]);
  const cancel = () => {
    setPicks(initial);
    setLeads(p.leadsPublishTier1);
    setError('');
    setEditing(false);
  };
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const { proposeReviewRules } = await import('../../../scripts/roles');
      const rights: Rights = { approveDesign: groupsOf(picks.approveDesign), approveTech: groupsOf(picks.approveTech), ship: groupsOf(picks.ship) };
      const pr = await proposeReviewRules({ rights, leadsPublishTier1: leads, owners: p.owners, visualMode: p.visualMode }, { prefix: p.prefix, protectedBranches: p.protectedBranches });
      setSent({ number: pr.number });
      setEditing(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <>
        {p.children}
        {sent && (
          <Alert tone="success" className="set-rules-sent">
            Sent for review. {RULES_NEED_REVIEW}. <Link href={studioHref(`changes/?pr=${sent.number}`)}>See the change</Link>
          </Alert>
        )}
        {can === true && (
          <div className="set-rules-actions">
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Edit review rules
            </Button>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="set-rows" role="group" aria-label="Edit review rules">
      {RIGHTS.map((r) => (
        <div className="set-row" key={r}>
          <div>
            <p className="set-row-label" id={`ts-right-${r}`}>
              {RIGHT_PLAIN[r].label}
            </p>
            <p className="set-row-help">{RIGHT_PLAIN[r].help}</p>
          </div>
          <div className="set-row-value set-row-span">
            <SegmentedControl aria-labelledby={`ts-right-${r}`} items={CHOICES} value={picks[r]} onValueChange={(v) => setPicks((x) => ({ ...x, [r]: v as RightChoice }))} />
          </div>
        </div>
      ))}
      <div className="set-row">
        <div className="set-row-value set-row-full">
          <Switch label="Leads can publish small changes without review" description="Guidance, docs and fixes with no visual change. Team admins and the reviewers of that part publish them." labelPlacement="start" checked={leads} onCheckedChange={setLeads} />
        </div>
      </div>
      <Alert tone="info" announce="off">
        {RULES_NEED_REVIEW}.
      </Alert>
      {error && (
        <Alert tone="danger" announce="auto">
          {error}
        </Alert>
      )}
      <div className="set-rules-actions">
        <Button variant="primary" loading={busy} disabled={busy || !changed} onClick={() => void save()}>
          Send for review
        </Button>
        <Button variant="ghost" onClick={cancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
