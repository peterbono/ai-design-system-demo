import styles from '../components/Avatar/Avatar.module.css';
import { AGENT_MARK, avatarName, initials, type AvatarAgentBrand, type AvatarFallback, type AvatarKind, type AvatarSize } from '../components/Avatar/Avatar';
import { attrs, classNames, escapeHtml, type HtmlAttributes } from './html';

export interface AvatarHtmlOptions {
  /** Same as `<Avatar name>`: the accessible name and the initials. Optional for an agent preset. */
  name?: string;
  /** Same as `<Avatar size>`. Default `md`. */
  size?: AvatarSize;
  /** Same as `<Avatar decorative>`. */
  decorative?: boolean;
  /** Same as `<Avatar fallback>`. Default `initials`. */
  fallback?: AvatarFallback;
  /**
   * Same as `<Avatar illustration>`: the illustrated face, for example `illustratedAvatarUri(login)` from
   * `@bridge-ds/react/avatar-illustrated`. Without it, `fallback: 'illustrated'` shows initials.
   */
  illustration?: string;
  /** Same as `<Avatar kind>`. */
  kind?: AvatarKind;
  /** Same as `<Avatar brand>`, with `kind: 'agent'`: names the agent ("Claude AI"). The mark is always Bridge's. */
  brand?: AvatarAgentBrand;
  /** Extra classes for layout, never to restyle the avatar. */
  className?: string;
  /** Extra attributes on the root: `data-*` hooks, `id`, `title`. */
  attributes?: HtmlAttributes;
}

/**
 * The exact markup `<Avatar>` renders on the server, as an HTML string, for rows built in plain scripts. Photos load
 * on the client in React only: here the avatar shows its fallback (initials, the illustrated face, or the agent mark).
 */
export function avatarHtml(options: AvatarHtmlOptions): string {
  const { size = 'md', decorative = false, fallback = 'initials', illustration, kind, className, attributes } = options;
  const name = avatarName(options);
  const agent = kind === 'agent';
  const drawn = !agent && fallback === 'illustrated' && Boolean(illustration);
  const root = attrs({ role: decorative ? undefined : 'img', 'aria-label': decorative ? undefined : name, 'aria-hidden': decorative ? 'true' : undefined, ...attributes });
  const cls = classNames(styles.avatar, styles[size], agent && styles.agent, drawn && styles.illustrated, className);
  const inner = agent
    ? `<svg class="${styles.mark}" viewBox="${AGENT_MARK.viewBox}" fill="none" aria-hidden="true" focusable="false"><path class="${styles.line}" d="${AGENT_MARK.path}"></path></svg>`
    : `<span aria-hidden="true" class="${styles.fallback}">${drawn ? `<img class="${styles.illustration}" src="${escapeHtml(illustration).replace(/'/g, "&#x27;")}" alt=""/>` : escapeHtml(initials(name))}</span>`;
  return `<span${root} class="${cls}">${inner}</span>`;
}
