import styles from '../components/TokenValue/TokenValue.module.css';
import type { TokenValueSize } from '../components/TokenValue';
import { swatchColor } from '../utils/color';
import { attrs, classNames, escapeHtml, type HtmlAttributes } from './html';

export interface TokenValueHtmlOptions {
  /** Same as `<TokenValue name>`. */
  name?: string;
  /** Same as `<TokenValue resolved>`. */
  resolved?: string;
  /** Same as `<TokenValue swatch>`. */
  swatch?: string | false;
  /** Same as `<TokenValue previous>`. */
  previous?: boolean;
  /** Same as `<TokenValue size>`. Default `md`. */
  size?: TokenValueSize;
  /** Extra classes for layout, never to restyle the chip. */
  className?: string;
  /** Extra attributes on the chip: `data-*` hooks, `title`, or `tooltipAttributes()`. */
  attributes?: HtmlAttributes;
}

/** The exact markup of `<TokenValue>` as an HTML string, for token tables built in plain scripts. Text is escaped. */
export function tokenValueHtml(value: string, options: TokenValueHtmlOptions = {}): string {
  const { name, resolved, swatch, previous = false, size = 'md', className } = options;
  const color = swatchColor(swatch, resolved, value);
  const body = `<span class="${styles.value}">${escapeHtml(value)}</span>${resolved != null && resolved !== value ? `<span class="${styles.resolved}">${escapeHtml(resolved)}</span>` : ''}`;
  const tag = previous ? 'del' : 'span';
  return (
    `<span class="${classNames(styles.root, styles[size], previous && styles.previous, className)}"${attrs(options.attributes)}>` +
    (color ? `<span class="${styles.swatch}" style="background-color:${escapeHtml(color)}" aria-hidden="true"></span>` : '') +
    (name ? `<span class="${styles.name}">${escapeHtml(name)}</span>` : '') +
    `<${tag} class="${styles.text}">${body}</${tag}></span>`
  );
}
