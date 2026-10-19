import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../test/axe';
import { CodeBlock } from './CodeBlock';

function mockClipboard(writeText = vi.fn().mockResolvedValue(undefined)) {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  return writeText;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('CodeBlock', () => {
  it('copies the code from the keyboard; the button says Copied and the live region announces it', async () => {
    const onCopy = vi.fn();
    render(<CodeBlock label="Install" code="npm install @bridge-ds/react" onCopy={onCopy} />);
    const writeText = mockClipboard();
    const button = screen.getByRole('button', { name: 'Copy install' });
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('');

    // Wrapped (the default): no scroll stop, Tab goes straight to the copy button.
    await userEvent.tab();
    expect(button).toHaveFocus();
    await userEvent.keyboard('{Enter}');

    expect(writeText).toHaveBeenCalledWith('npm install @bridge-ds/react');
    expect(onCopy).toHaveBeenCalledWith('npm install @bridge-ds/react');
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
    expect(status).toHaveTextContent('Copied to the clipboard.');
    await expectNoAxeViolations();
  });

  it('goes back to Copy after two seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockClipboard();
    render(<CodeBlock label="Install" code="npm install @bridge-ds/react" copiedLabel="Command copied" />);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByRole('button', { name: 'Copy install' }));
    expect(await screen.findByRole('button', { name: 'Command copied' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Command copied to the clipboard.');
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByRole('button', { name: 'Copy install' })).toBeInTheDocument();
  });

  it('the scroll area is focusable when lines do not wrap, not when they wrap', () => {
    const { rerender } = render(<CodeBlock code="npx @bridge-ds/cli publish" wrap={false} />);
    const pre = () => screen.getByText('npx @bridge-ds/cli publish').closest('pre');
    expect(pre()).toHaveAttribute('tabindex', '0');
    rerender(<CodeBlock code="npx @bridge-ds/cli publish" />);
    expect(pre()).not.toHaveAttribute('tabindex');
  });

  it('hideCopy removes the button and the live region', async () => {
    render(<CodeBlock label="Token file" code="tokens/semantic/color.json" hideCopy />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    await expectNoAxeViolations();
  });

  it('renders the static contract bindCodeBlocks reads', () => {
    const html = renderToStaticMarkup(<CodeBlock label="Install" code="npm install @bridge-ds/react" codeProps={{ id: 'install-cmd' }} />);
    expect(html).toContain('data-code-block=""');
    expect(html).toContain('data-code-block-code=""');
    expect(html).toContain('id="install-cmd"');
    expect(html).toContain('data-code-block-copy=""');
    expect(html).toContain('data-code-block-status=""');
    expect(html).not.toContain('data-live');
  });
});
