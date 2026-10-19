import styles from '../components/Checklist/Checklist.module.css';
import hiddenStyles from '../components/VisuallyHidden/VisuallyHidden.module.css';
import type { ChecklistStatus } from '../components/Checklist';
import { attrs, classNames, content, escapeHtml, type HtmlAttributes, type TrustedHtml } from './html';
import { iconHtml, type DomIconName } from './icons';

const STATUS_LABEL: Record<ChecklistStatus, string> = { done: 'Done', failed: 'Failed', waiting: 'Waiting', warning: 'Needs attention' };
const STATUS_ICON: Record<ChecklistStatus, DomIconName | null> = { done: 'check', failed: 'x', waiting: null, warning: 'triangle-alert' };

export interface ChecklistRowHtmlOptions {
  /** Same as `<ChecklistRow status>`. */
  status: ChecklistStatus;
  /** Same as `<ChecklistRow title>`. Escaped unless `trusted()`. */
  title: string | TrustedHtml;
  /** Same as `<ChecklistRow detail>`. Escaped unless `trusted()`. */
  detail?: string | TrustedHtml;
  /** Same as `<ChecklistRow action>`: markup you built (a button), passed with `trusted()`. */
  action?: TrustedHtml;
  /** Same as `<ChecklistRow statusLabel>`. */
  statusLabel?: string;
  /** Attributes on the action wrapper, for example an `id` where a script mounts the action later. */
  actionAttributes?: HtmlAttributes;
  className?: string;
  /** Extra attributes on the row: `id`, `data-*` hooks. */
  attributes?: HtmlAttributes;
}

/** The exact markup of `<ChecklistRow>` as an HTML string. */
export function checklistRowHtml(options: ChecklistRowHtmlOptions): string {
  const { status, title, detail, action, statusLabel, className } = options;
  const glyph = STATUS_ICON[status];
  const hasAction = action != null || options.actionAttributes != null;
  return (
    `<li class="${classNames(styles.row, className)}" data-status="${status}"${attrs(options.attributes)}>` +
    `<span class="${classNames(styles.icon, styles[status])}" aria-hidden="true">${glyph ? iconHtml(glyph, 'sm') : ''}</span>` +
    `<span class="${styles.title}">${content(title)}</span>` +
    `<span class="${styles.detail}"><span class="${hiddenStyles.hidden}">${escapeHtml(`${statusLabel ?? STATUS_LABEL[status]}: `)}</span>${detail != null ? content(detail) : ''}</span>` +
    (hasAction ? `<span class="${styles.action}"${attrs(options.actionAttributes)}>${action ? action.html : ''}</span>` : '') +
    `</li>`
  );
}

export interface ChecklistHtmlOptions {
  /** Same as `<Checklist label>`. */
  label?: string;
  /** Same as `<Checklist footer>`: markup you built, passed with `trusted()`. */
  footer?: TrustedHtml;
  className?: string;
  /** Extra attributes on the list. */
  attributes?: HtmlAttributes;
}

/** The exact markup of `<Checklist>` around rows from `checklistRowHtml()`. */
export function checklistHtml(rows: string[], options: ChecklistHtmlOptions = {}): string {
  const footer = options.footer ? `<li class="${styles.footer}">${options.footer.html}</li>` : '';
  return `<ul class="${classNames(styles.list, options.className)}"${options.label ? ` aria-label="${escapeHtml(options.label)}"` : ''}${attrs(options.attributes)}>${rows.join('')}${footer}</ul>`;
}
