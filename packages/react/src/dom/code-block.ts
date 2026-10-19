import styles from '../components/CodeBlock/CodeBlock.module.css';
import buttonStyles from '../components/Button/Button.module.css';
import hiddenStyles from '../components/VisuallyHidden/VisuallyHidden.module.css';
import { CODE_BLOCK_COPIED_MS, copyText } from '../utils/copy';
import { attrs, classNames, content, escapeHtml, type HtmlAttributes, type TrustedHtml } from './html';
import { iconHtml } from './icons';

export interface CodeBlockHtmlOptions {
  /** Same as `<CodeBlock label>`: what the code is, above the block. Also names the copy button. */
  label?: string | TrustedHtml;
  /** Same as `<CodeBlock wrap>`. */
  wrap?: boolean;
  /** Same as `<CodeBlock copyLabel>`. Default "Copy". */
  copyLabel?: string;
  /** Same as `<CodeBlock copiedLabel>`. Default "Copied". Read by `bindCodeBlocks` from `data-copied-label`. */
  copiedLabel?: string;
  /** Same as `<CodeBlock hideCopy>`. */
  hideCopy?: boolean;
  /** Extra classes for layout (margins, grid placement), never to restyle the block. */
  className?: string;
  /** Extra attributes on the root: `id`, `data-*` hooks. */
  attributes?: HtmlAttributes;
  /** Attributes on the `<code>` element, for example an `id` a script fills later. */
  codeAttributes?: HtmlAttributes;
}

const copyButton = (copyLabel: string, name: string | undefined, icon: 'copy' | 'check') =>
  `<button type="button" tabindex="0" data-code-block-copy=""${name ? ` aria-label="${escapeHtml(name)}"` : ''} class="${classNames(buttonStyles.button, buttonStyles.ghost, buttonStyles.sm, styles.copy)}">${iconHtml(icon, 'sm', buttonStyles.icon)}<span class="${buttonStyles.label}">${escapeHtml(copyLabel)}</span></button>`;

/**
 * The exact markup of `<CodeBlock>` as an HTML string, for pages that build content in plain scripts. Call
 * `bindCodeBlocks()` once so its copy button works. `code` is escaped.
 */
export function codeBlockHtml(code: string, options: CodeBlockHtmlOptions = {}): string {
  const { label, wrap = false, copyLabel = 'Copy', copiedLabel, hideCopy = false, className } = options;
  const name = typeof label === 'string' ? `${copyLabel} ${label.toLowerCase()}` : undefined;
  const rootAttrs = attrs({ ...(copiedLabel && copiedLabel !== 'Copied' ? { 'data-copied-label': copiedLabel } : {}), ...options.attributes });
  return (
    `<div class="${classNames(styles.root, wrap && styles.wrap, className)}" data-code-block=""${rootAttrs}>` +
    (label != null ? `<div class="${styles.label}">${content(label)}</div>` : '') +
    `<div class="${styles.plate}"><pre class="${styles.pre}"${wrap ? '' : ' tabindex="0"'}><code class="${styles.code}" data-code-block-code=""${attrs(options.codeAttributes)}>${escapeHtml(code)}</code></pre>` +
    (hideCopy ? '' : copyButton(copyLabel, name, 'copy')) +
    `</div>` +
    (hideCopy ? '' : `<span class="${hiddenStyles.hidden}" role="status" data-code-block-status=""></span>`) +
    `</div>`
  );
}

const BOUND = new WeakSet<Document | HTMLElement>();

/**
 * Makes the copy buttons of statically rendered CodeBlocks work (`<CodeBlock>` rendered to HTML without hydration,
 * or `codeBlockHtml()`): one delegated click listener on `root`, for blocks present now or added later. Blocks a
 * hydrated React CodeBlock handles itself (`data-live`) are skipped. Idempotent per root.
 */
export function bindCodeBlocks(root: Document | HTMLElement = document): void {
  if (BOUND.has(root)) return;
  BOUND.add(root);
  root.addEventListener('click', (e) => {
    const target = e.target as Element | null;
    const button = target?.closest?.<HTMLButtonElement>('[data-code-block-copy]');
    const block = button?.closest<HTMLElement>('[data-code-block]');
    if (!button || !block || block.hasAttribute('data-live')) return;
    const code = block.querySelector('[data-code-block-code]')?.textContent ?? '';
    const status = block.querySelector('[data-code-block-status]');
    const labelEl = button.querySelector(`.${CSS.escape(buttonStyles.label!)}`);
    const copyLabel = button.dataset.codeBlockLabel ?? labelEl?.textContent ?? 'Copy';
    button.dataset.codeBlockLabel = copyLabel;
    const copiedLabel = block.getAttribute('data-copied-label') ?? 'Copied';
    void copyText(code).then((ok) => {
      const timer = Number(button.dataset.codeBlockTimer ?? 0);
      if (timer) clearTimeout(timer);
      if (!ok) {
        const codeEl = block.querySelector('[data-code-block-code]');
        const sel = window.getSelection();
        if (sel && codeEl) {
          const range = document.createRange();
          range.selectNodeContents(codeEl);
          sel.removeAllRanges();
          sel.addRange(range);
        }
        if (status) status.textContent = 'Copy did not work here. The code is selected: press Ctrl+C or Cmd+C.';
        return;
      }
      const name = button.getAttribute('aria-label');
      if (name) button.dataset.codeBlockName = name;
      button.removeAttribute('aria-label');
      button.innerHTML = `${iconHtml('check', 'sm', buttonStyles.icon)}<span class="${buttonStyles.label}">${escapeHtml(copiedLabel)}</span>`;
      block.setAttribute('data-copied', '');
      if (status) status.textContent = `${copiedLabel} to the clipboard.`;
      button.dispatchEvent(new CustomEvent('bridge:copied', { bubbles: true, detail: { code } }));
      button.dataset.codeBlockTimer = String(
        setTimeout(() => {
          button.innerHTML = `${iconHtml('copy', 'sm', buttonStyles.icon)}<span class="${buttonStyles.label}">${escapeHtml(copyLabel)}</span>`;
          if (button.dataset.codeBlockName) button.setAttribute('aria-label', button.dataset.codeBlockName);
          block.removeAttribute('data-copied');
          if (status) status.textContent = '';
          delete button.dataset.codeBlockTimer;
        }, CODE_BLOCK_COPIED_MS),
      );
    });
  });
}
