// The role picker (board I2), shared by the Invite collaborators dialog and every row of Settings > Members: a DS
// Button that names the role ("Can edit", "Reviewer: design") and opens a DS Popover with the four roles as a DS
// RadioGroup, each with one line that says what it adds. Choosing Reviewer unfolds, under it, "They review as": two
// DS ChoiceCards stacked, each one line with its drawing, name and what it reviews: Designer (how it looks and works)
// and Developer (how it is built). The help sits in the card's name, so a screen reader reads the whole line on the
// radio. A DS Menu or Select cannot hold a second radio group inside an item, hence Popover + RadioGroup. Nothing else unfolds: progressive
// disclosure. A role GitHub cannot hold on this repository (a personal account's) is shown disabled with the reason. An
// email member has no Reviewer: they approve as a design lead or an admin, and members, requests, settings and invites
// need no GitHub.
// An email member can be a design lead: a role of the list, in order of power, between Can edit and Admin.
// What each role means on GitHub stays out of sight (lib/invites.ts).
import { Fragment, useId, useState, type KeyboardEvent } from 'react';
import { ChevronDown, Code2, PenTool } from 'lucide-react';
import { Button, ChoiceCard, ChoiceCardGroup, Icon, Popover, PopoverContent, PopoverTrigger, Radio, RadioGroup } from '@bridge-ds/react';
import { normalizeChoice, PERSONAL_NOTE, REVIEW_AS_ORDER, REVIEW_AS_WORDS, ROLE_WORDS, roleChoices, roleLabel, type ReviewAs, type RoleChoice } from '../../../lib/invites';
import '../../../styles/invites.css';

export interface RolePickerProps {
  value: RoleChoice;
  onChange: (next: RoleChoice) => void;
  /** Accessible name of the trigger: "Role", "Role for Ann". The visible text is the role. */
  label: string;
  /** A personal account's repository: Admin is disabled, with the reason. */
  personal?: boolean;
  /** An email member: no Reviewer, they approve as a design lead or an admin. */
  emailOnly?: boolean;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  /** ghost: a quiet trigger inside a list (the dialog's "Who has access"). */
  variant?: 'secondary' | 'ghost';
  /** An email member: Design lead joins the roles, between Can edit and Admin. `then`: the role picked instead of it. Unset: not offered. */
  lead?: { on: boolean; onChange: (on: boolean, then?: RoleChoice) => void };
  /** The role the trigger names, when it says more than one choice can ("Reviewer: design and code", lib/invites roleText). */
  shown?: string;
}

const LEAD_WORDS = { label: 'Design lead', help: 'Also approves explorations before the developers.' };
const LEAD = 'lead';

const REVIEW_ICON = { design: PenTool, tech: Code2 } as const;

export default function RolePicker({ value, onChange, label, personal = false, emailOnly = false, lead, disabled = false, size = 'md', variant = 'secondary', shown }: RolePickerProps) {
  const [open, setOpen] = useState(false);
  const choice = normalizeChoice(value);
  const id = useId();
  // An email member: GitHub's personal-repository rule does not apply to them (Admin is a Bridge role there).
  // An email member approves as a design lead or an admin: Reviewer, on GitHub, is not offered.
  const choices = (emailOnly ? roleChoices(false).filter((c) => c.role !== 'reviewer') : roleChoices(personal));
  const pick = (role: string) => {
    if (role === LEAD) {
      lead?.onChange(true);
      setOpen(false);
      return;
    }
    if (lead?.on) {
      lead.onChange(false, normalizeChoice({ role: role as RoleChoice['role'] }));
      setOpen(false);
      return;
    }
    const next = normalizeChoice({ role: role as RoleChoice['role'], ...(role === 'reviewer' ? { reviewAs: choice.reviewAs ?? 'design' } : {}) });
    onChange(next);
    // A plain role is one choice: the popover closes. Reviewer stays open for "They review as".
    if (role !== 'reviewer') setOpen(false);
  };
  const leads = Boolean(lead?.on && choice.role === 'edit');
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
        render={<Button variant={variant} size={size} className="rp-trigger" disabled={disabled} aria-label={`${label}: ${shown ?? roleLabel(choice)}`} />}
      >
        <span className="rp-trigger-body">
          <span>{shown ?? roleLabel(choice)}</span>
          <Icon icon={ChevronDown} size="sm" />
        </span>
      </PopoverTrigger>
      <PopoverContent className="rp-pop" side="bottom" align="end" arrow={false} aria-label={label}>
        <RadioGroup label={label} hideLabel value={leads ? LEAD : choice.role} onValueChange={pick} className="rp-roles">
          {choices.map(({ role, disabled: off }) => (
            <Fragment key={role}>
            {lead && role === 'admin' && (
              <div className="rp-role" data-selected={leads ? '' : undefined}>
                <Radio value={LEAD} label={LEAD_WORDS.label} description={LEAD_WORDS.help} />
              </div>
            )}
            <div className="rp-role" data-selected={choice.role === role && !leads ? '' : undefined}>
              <Radio value={role} label={ROLE_WORDS[role].label} description={ROLE_WORDS[role].help} disabled={off} />
              {role === 'reviewer' && choice.role === 'reviewer' && (
                <div className="rp-review" onKeyDown={keepKeys}>
                  <ChoiceCardGroup label="They review as" value={choice.reviewAs ?? 'design'} onValueChange={pickReviewAs} orientation="vertical" className="rp-review-cards" name={`${id}-review`}>
                    {REVIEW_AS_ORDER.map((r) => (
                      <ChoiceCard
                        key={r}
                        value={r}
                        title={
                          <span className="rp-review-title">
                            <span className="rp-review-face" aria-hidden="true">
                              <Icon icon={REVIEW_ICON[r]} size="md" />
                            </span>
                            <span className="rp-review-name">{REVIEW_AS_WORDS[r].label}</span>
                            {/* A space, so a screen reader reads "Designer How it looks and works", not one word. */}{' '}
                            <span className="rp-review-help">{REVIEW_AS_WORDS[r].help}</span>
                          </span>
                        }
                      />
                    ))}
                  </ChoiceCardGroup>
                </div>
              )}
            </div>
            </Fragment>
          ))}
        </RadioGroup>
        {!emailOnly && personal && <p className="rp-note">{PERSONAL_NOTE}</p>}
      </PopoverContent>
    </Popover>
  );
}
