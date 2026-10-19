import styles from '../components/Badge/Badge.module.css';
import type { BadgeAppearance, BadgeSize, BadgeTone } from '../components/Badge';
import { attrs, classNames, content, type HtmlAttributes, type TrustedHtml } from './html';

export interface BadgeHtmlOptions {
  /** Same as `<Badge tone>`. Default `neutral`. */
  tone?: BadgeTone;
  /** Same as `<Badge appearance>`. Default `subtle`. */
  appearance?: BadgeAppearance;
  /** Same as `<Badge size>`. Default `md`. */
  size?: BadgeSize;
  /** Same as `<Badge dot>`. */
  dot?: boolean;
  /** Extra classes for layout (margins, grid placement), never to restyle the badge. */
  className?: string;
  /** Extra attributes on the badge: `data-*` hooks, `id`, `title`, `aria-*`, or `tooltipAttributes()`. */
  attributes?: HtmlAttributes;
}

/** The class list `<Badge>` puts on its root, for code that creates the element itself. */
export function badgeClassName({ tone = 'neutral', appearance = 'subtle', size = 'md', className }: Omit<BadgeHtmlOptions, 'dot' | 'attributes'> = {}): string {
  return classNames(styles.badge, styles[appearance], styles[tone], styles[size], className);
}

/**
 * The exact markup of `<Badge>` as an HTML string, for pages that build rows in plain scripts. `text` is escaped;
 * pass `trusted(html)` for markup you escaped yourself. Icons are React-only: use `dot` here.
 */
export function badgeHtml(text: string | number | TrustedHtml, options: BadgeHtmlOptions = {}): string {
  const dot = options.dot ? `<span class="${styles.dot}" aria-hidden="true"></span>` : '';
  return `<span class="${badgeClassName(options)}"${attrs(options.attributes)}>${dot}${content(text)}</span>`;
}
