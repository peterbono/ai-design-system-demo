// The role picker (board I2), shared by the Invite collaborators dialog and every row of Settings > Members: a DS
// Button that names the role ("Can edit", "Reviewer: design") and opens a DS Popover with the four roles as a DS
// RadioGroup, each with one line that says what it adds. Choosing Reviewer unfolds, under it, "They review as": two
// DS ChoiceCards, Designer (how it looks and works) and Developer (how it is built). Nothing else unfolds: progressive
// disclosure. A role GitHub cannot hold on this repository (a personal account's) is shown disabled with the reason, and
// so are Reviewer and Admin for an email contributor (reviewers and admins approve on GitHub).
// What each role means on GitHub stays out of sight (lib/invites.ts).
import { useId, useState, type KeyboardEvent } from 'react';
import { ChevronDown, Code2, PenTool } from 'lucide-react';
import { Button, ChoiceCard, ChoiceCardGroup, Icon, Popover, PopoverContent, PopoverTrigger, Radio, RadioGroup } from '@bridge-ds/react';
import { normalizeChoice, PERSONAL_NOTE, REVIEW_AS_ORDER, REVIEW_AS_WORDS, ROLE_WORDS, roleChoices, roleLabel, type ReviewAs, type RoleChoice } from '../../../lib/invites';
import { CONTRIBUTE_WORDS } from '../../../lib/contribute';
import '../../../styles/invites.css';

export interface RolePickerProps {
  value: RoleChoice;
  onChange: (next: RoleChoice) => void;
  /** Accessible name of the trigger: "Role", "Role for Ann". The visible text is the role. */
  label: string;
  /** A personal account's repository: Admin is disabled, with the reason. */
  personal?: boolean;
  /** An email contributor: Reviewer and Admin are disabled, with the reason (they approve on GitHub). */
  emailOnly?: boolean;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  /** ghost: a quiet trigger inside a list (the dialog's "Who has access"). */
  variant?: 'secondary' | 'ghost';
}

const REVIEW_ICON = { design: PenTool, tech: Code2 } as const;

export default function RolePicker({ value, onChange, label, personal = false, emailOnly = false, disabled = false, size = 'md', variant = 'secondary' }: RolePickerProps) {
  const [open, setOpen] = useState(false);
  const choice = normalizeChoice(value);
  const id = useId();
  const choices = roleChoices(personal).map((c) => (emailOnly && c.role !== 'edit' ? { ...c, disabled: true } : c));
  const pick = (role: string) => {
    const next = normalizeChoice({ role: role as RoleChoice['role'], ...(role === 'reviewer' ? { reviewAs: choice.reviewAs ?? 'design' } : {}) });
    onChange(next);
    // A plain role is one choice: the popover closes. Reviewer stays open for "They review as".
    if (role !== 'reviewer') setOpen(false);
  };
  const pickReviewAs = (v: string) => {
    onChange({ role: 'reviewer', reviewAs: v as ReviewAs });
  };
  // The inner cards keep their own arrow keys: the outer role list must not move at the same time.
  const keepKeys = (e: KeyboardEvent) => {
    if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End') e.stopPropagation();
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button variant={variant} size={size} className="rp-trigger" disabled={disabled} aria-label={`${label}: ${roleLabel(choice)}`} />}
      >
        <span className="rp-trigger-body">
          <span>{roleLabel(choice)}</span>
          <Icon icon={ChevronDown} size="sm" />
        </span>
      </PopoverTrigger>
      <PopoverContent className="rp-pop" side="bottom" align="end" arrow={false} aria-label={label}>
        <RadioGroup label={label} hideLabel value={choice.role} onValueChange={pick} className="rp-roles">
          {choices.map(({ role, disabled: off }) => (
            <div key={role} className="rp-role" data-selected={choice.role === role ? '' : undefined}>
              <Radio value={role} label={ROLE_WORDS[role].label} description={ROLE_WORDS[role].help} disabled={off} />
              {role === 'reviewer' && choice.role === 'reviewer' && (
                <div className="rp-review" onKeyDown={keepKeys}>
                  <ChoiceCardGroup label="They review as" value={choice.reviewAs ?? 'design'} onValueChange={pickReviewAs} orientation="horizontal" className="rp-review-cards" name={`${id}-review`}>
                    {REVIEW_AS_ORDER.map((r) => (
                      <ChoiceCard
                        key={r}
                        value={r}
                        title={
                          <span className="rp-review-title">
                            <span className="rp-review-face" aria-hidden="true">
                              <Icon icon={REVIEW_ICON[r]} size="sm" />
                            </span>
                            {REVIEW_AS_WORDS[r].label}
                          </span>
                        }
                        description={REVIEW_AS_WORDS[r].help}
                      />
                    ))}
                  </ChoiceCardGroup>
                </div>
              )}
            </div>
          ))}
        </RadioGroup>
        {emailOnly ? <p className="rp-note">{CONTRIBUTE_WORDS.emailRoleNote}</p> : personal && <p className="rp-note">{PERSONAL_NOTE}</p>}
      </PopoverContent>
    </Popover>
  );
}
