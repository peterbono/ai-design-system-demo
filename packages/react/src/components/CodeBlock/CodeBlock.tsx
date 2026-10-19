import { forwardRef, useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import { cx } from '../../utils/cx';
import { Button } from '../Button';
import { VisuallyHidden } from '../VisuallyHidden';
import { CODE_BLOCK_COPIED_MS, copyText } from '../../utils/copy';
import styles from './CodeBlock.module.css';

export interface CodeBlockProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'onCopy'> {
  /** The code or command, shown as is and copied as is. */
  code: string;
  /** What the code is, above the block: "Install", "Add the MCP server". Also names the copy button. */
  label?: ReactNode;
  /** Wrap long lines instead of scrolling sideways. Default `false`: commands keep one line and scroll. */
  wrap?: boolean;
  /** The copy button text. Default "Copy". */
  copyLabel?: string;
  /** The button text after a copy, for two seconds. Default "Copied". */
  copiedLabel?: string;
  /** Hide the copy button (code the reader should read, not paste). */
  hideCopy?: boolean;
  /** Called after the code reached the clipboard. */
  onCopy?: (code: string) => void;
  /** Attributes on the `<code>` element, for example an `id` a script reads or fills. */
  codeProps?: HTMLAttributes<HTMLElement> & { [key: `data-${string}`]: string | undefined };
}

/**
 * Code or a command in IBM Plex Mono, with a copy button on the same line. The button says "Copied" for two seconds
 * and a polite live region announces it. Long lines scroll inside the block (keyboard reachable), or wrap.
 *
 * Static contract (no hydration): the root carries `data-code-block`, the code `data-code-block-code`, the button
 * `data-code-block-copy` and the live region `data-code-block-status`. `bindCodeBlocks()` from
 * `@bridge-ds/react/dom` wires copy on statically rendered blocks.
 */
export const CodeBlock = forwardRef<HTMLDivElement, CodeBlockProps>(function CodeBlock(
  { code, label, wrap = false, copyLabel = 'Copy', copiedLabel = 'Copied', hideCopy = false, onCopy, codeProps, className, ...rest },
  ref,
) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const [live, setLive] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const codeRef = useRef<HTMLElement>(null);
  useEffect(() => {
    setLive(true);
    return () => clearTimeout(timer.current);
  }, []);
  const name = typeof label === 'string' ? `${copyLabel} ${label.toLowerCase()}` : undefined;

  const copy = async () => {
    const ok = await copyText(code);
    clearTimeout(timer.current);
    if (!ok) {
      // Select the code so the reader can copy it with the keyboard, and say so.
      const sel = window.getSelection();
      if (sel && codeRef.current) {
        const range = document.createRange();
        range.selectNodeContents(codeRef.current);
        sel.removeAllRanges();
        sel.addRange(range);
      }
      setFailed(true);
      setCopied(false);
      return;
    }
    setFailed(false);
    setCopied(true);
    onCopy?.(code);
    timer.current = setTimeout(() => setCopied(false), CODE_BLOCK_COPIED_MS);
  };

  return (
    <div ref={ref} className={cx(styles.root, wrap && styles.wrap, className)} data-code-block="" data-copied-label={copiedLabel !== 'Copied' ? copiedLabel : undefined} data-copied={copied || undefined} data-live={live || undefined} {...rest}>
      {label != null && <div className={styles.label}>{label}</div>}
      <div className={styles.plate}>
        <pre className={styles.pre} tabIndex={wrap ? undefined : 0}>
          <code ref={codeRef} className={styles.code} data-code-block-code="" {...codeProps}>
            {code}
          </code>
        </pre>
        {!hideCopy && (
          <Button variant="ghost" size="sm" iconStart={copied ? Check : Copy} className={styles.copy} data-code-block-copy="" aria-label={copied ? undefined : name} onClick={copy}>
            {copied ? copiedLabel : copyLabel}
          </Button>
        )}
      </div>
      {!hideCopy && (
        <VisuallyHidden role="status" data-code-block-status="">
          {copied ? `${copiedLabel} to the clipboard.` : failed ? 'Copy did not work here. The code is selected: press Ctrl+C or Cmd+C.' : ''}
        </VisuallyHidden>
      )}
    </div>
  );
});
