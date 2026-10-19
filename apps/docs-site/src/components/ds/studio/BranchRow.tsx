// One branch row, the same everywhere a branch is listed (Studio home Needs you, the review queue, Branches): the
// before/after thumbnail, who, the title (the link covers the whole card), an optional Jira key in mono, one muted
// line after a middle dot, the status pill right after the text, then an optional end slot (a row button, or how far
// main moved on with "Update from main"). `lead` holds a control before the thumbnail (Branches: the checkbox to
// preview token branches together); controls inside the card stay clickable above the covering link (DS Card).
// Styles: styles/studio-home.css (sh-row-*).
import type { MouseEvent, ReactNode } from 'react';
import { Badge, Card, CardBody, Link } from '@bridge-ds/react';
import { BranchThumb } from './BranchThumb';
import type { PillTone } from '../../../lib/home-model';
import type { ThumbSpec } from '../../../lib/branch-thumb';

const TONE = { warning: 'warning', danger: 'danger', success: 'success', neutral: 'neutral', info: 'info' } as const;

export interface BranchRowProps {
  thumb: ThumbSpec;
  /** The avatar (or an icon for rows without a person). Decorative: the line names the person. */
  who: ReactNode;
  title: string;
  href: string;
  onClick?: (e: MouseEvent<HTMLAnchorElement>) => void;
  /** Extra attributes on the title link (data-open-pr for the in-place branch review). */
  linkAttributes?: Record<string, string | number | undefined>;
  selected?: boolean;
  /** Jira ticket key, after the title in mono. */
  jira?: string | null;
  /** After the title and a middle dot: who, or why it waits. */
  line?: string | null;
  pill?: { label: string; tone: PillTone | 'info' } | null;
  lead?: ReactNode;
  end?: ReactNode;
  className?: string;
}

export function BranchRow({ thumb, who, title, href, onClick, linkAttributes, selected, jira, line, pill, lead, end, className }: BranchRowProps) {
  return (
    <li className={className ? `sh-row-item ${className}` : 'sh-row-item'}>
      <Card interactive padding="compact" className={selected ? 'sh-row is-selected' : 'sh-row'}>
        <CardBody className="sh-row-body">
          {lead}
          <BranchThumb spec={thumb} size="row" />
          <span className="sh-row-who" aria-hidden="true">
            {who}
          </span>
          <span className="sh-row-text">
            <Link href={href} variant="subtle" className="t-body sh-row-title" data-card-primary onClick={onClick} aria-current={selected ? 'true' : undefined} {...linkAttributes}>
              <span className="sh-strong">{title}</span>
            </Link>
            {jira && (
              <span className="t-ui t-muted sh-row-jira">
                {' '}
                <span className="sh-mono">{jira}</span>
              </span>
            )}
            {line && (
              <>
                <span className="t-ui t-muted sh-row-sep" aria-hidden="true">
                  {' · '}
                </span>
                <span className="t-ui t-muted sh-row-line">{line}</span>
              </>
            )}
          </span>
          {pill && (
            <Badge tone={TONE[pill.tone]} size="md" className="sh-row-pill">
              {pill.label}
            </Badge>
          )}
          {end}
        </CardBody>
      </Card>
    </li>
  );
}
