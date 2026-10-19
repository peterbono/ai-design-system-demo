// Parity: every DOM renderer returns exactly the markup its React component renders (same elements, attributes and
// CSS Module classes), so a page built in plain scripts looks and behaves like one built with React.
import { renderToStaticMarkup } from 'react-dom/server';
import { act, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../test/axe';
import { Badge } from '../components/Badge';
import { CodeBlock } from '../components/CodeBlock';
import { TokenValue } from '../components/TokenValue';
import { Checklist, ChecklistRow } from '../components/Checklist';
import { badgeClassName, badgeHtml, bindCodeBlocks, bindTooltips, checklistHtml, checklistRowHtml, codeBlockHtml, tokenValueHtml, tooltipAttributes, tooltipHtmlAttributes, trusted } from './index';

describe('badgeHtml', () => {
  it.each([
    [{}, 'Draft'],
    [{ tone: 'success' as const, dot: true }, 'Approved'],
    [{ tone: 'danger' as const, appearance: 'solid' as const, size: 'sm' as const }, 'Fails <2>'],
    [{ tone: 'info' as const, className: 'row-badge', attributes: { 'data-status': 'open', title: 'Open "now"' } }, 'Open'],
  ])('matches <Badge %j>', (opts, text) => {
    const { attributes, ...props } = opts as { attributes?: Record<string, string> };
    expect(badgeHtml(text, opts)).toBe(renderToStaticMarkup(<Badge {...props} {...attributes}>{text}</Badge>));
  });

  it('gives the same class list as <Badge>', () => {
    expect(badgeClassName({ tone: 'warning' })).toBe('badge subtle warning md');
  });

  it('passes trusted markup through', () => {
    expect(badgeHtml(trusted('<b>2</b> left'))).toContain('<b>2</b> left');
  });
});

describe('codeBlockHtml', () => {
  it.each([
    ['npm install @bridge-ds/react', {}],
    ['npx bridge check', { label: 'Check a project' }],
    ['line one\nline <two>', { wrap: true, copyLabel: 'Copy code' }],
    ['echo hi', { hideCopy: true, attributes: { id: 'cmd' } }],
    ['npx bridge explore', { codeAttributes: { id: 'ex-cmd' } }],
    ['echo hi', { copiedLabel: 'Copied command', attributes: { 'data-x': '1' } }],
  ])('matches <CodeBlock code=%j %j>', (code, opts) => {
    const { attributes, codeAttributes, ...props } = opts as { attributes?: Record<string, string>; codeAttributes?: Record<string, string> };
    expect(codeBlockHtml(code, opts)).toBe(renderToStaticMarkup(<CodeBlock code={code} {...props} {...attributes} codeProps={codeAttributes} />));
  });

  it('copies on click once bound, says Copied, then resets', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    document.body.innerHTML = codeBlockHtml('npm i @bridge-ds/react', { label: 'Install' });
    bindCodeBlocks();
    const button = document.querySelector<HTMLButtonElement>('[data-code-block-copy]')!;
    expect(button).toHaveAccessibleName('Copy install');
    await expectNoAxeViolations();
    fireEvent.click(button);
    await waitFor(() => expect(button).toHaveTextContent('Copied'));
    expect(writeText).toHaveBeenCalledWith('npm i @bridge-ds/react');
    expect(document.querySelector('[data-code-block-status]')).toHaveTextContent('Copied to the clipboard.');
    await act(async () => {
      vi.advanceTimersByTime(2100);
    });
    expect(button).toHaveTextContent('Copy');
    expect(button).toHaveAccessibleName('Copy install');
    vi.useRealTimers();
  });
});

describe('tokenValueHtml', () => {
  it.each([
    ['#0B4A8B', {}],
    ['{color.harbor.700}', { name: 'color.action.primary.bg', resolved: '#0B4A8B' }],
    ['16px', { name: 'space.4', size: 'sm' as const }],
    ['#FFFFFF', { previous: true }],
    ['{color.ink.900}', { swatch: false as const, resolved: 'oklch(0.2 0.02 250)' }],
    ['x', { swatch: 'var(--color-bg-default)' }],
  ])('matches <TokenValue value=%j %j>', (value, opts) => {
    expect(tokenValueHtml(value, opts)).toBe(renderToStaticMarkup(<TokenValue value={value} {...opts} />));
  });

  it('never paints a swatch from something that is not a color', () => {
    expect(tokenValueHtml('x', { swatch: 'red;background:url(x)' })).not.toContain('style=');
  });
});

describe('checklistHtml', () => {
  it('matches <Checklist> with every row status, an action and a footer', () => {
    const html = checklistHtml(
      [
        checklistRowHtml({ status: 'done', title: 'Design rules', detail: 'Contrast passes' }),
        checklistRowHtml({ status: 'failed', title: 'Developer tests', detail: '2 failing', statusLabel: 'Fails' }),
        checklistRowHtml({ status: 'waiting', title: 'Design approval', detail: 'Waiting on @ana', action: trusted('<button type="button">Approve</button>'), attributes: { id: 'row-design' } }),
        checklistRowHtml({ status: 'warning', title: 'Latest library', detail: trusted('<em>Behind</em> by 2') }),
      ],
      { label: 'What it needs to ship', footer: trusted('<p>Only owners can approve.</p>') },
    );
    const react = renderToStaticMarkup(
      <Checklist label="What it needs to ship" footer={<p>Only owners can approve.</p>}>
        <ChecklistRow status="done" title="Design rules" detail="Contrast passes" />
        <ChecklistRow status="failed" title="Developer tests" detail="2 failing" statusLabel="Fails" />
        <ChecklistRow status="waiting" title="Design approval" detail="Waiting on @ana" action={<button type="button">Approve</button>} id="row-design" />
        <ChecklistRow
          status="warning"
          title="Latest library"
          detail={
            <>
              <em>Behind</em> by 2
            </>
          }
        />
      </Checklist>,
    );
    expect(html).toBe(react);
  });

  it('keeps an empty action slot a script fills later', () => {
    expect(checklistRowHtml({ status: 'waiting', title: 'Latest library', actionAttributes: { id: 'lib-act' } })).toContain('id="lib-act"></span></li>');
  });
});

describe('tooltips outside React', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('writes the trigger attributes', () => {
    expect(tooltipAttributes('Approved by the owner', { focusable: true })).toEqual({ 'data-tooltip': 'Approved by the owner', 'data-tooltip-side': undefined, tabindex: 0 });
    expect(tooltipHtmlAttributes('Say "hi"', { side: 'bottom' })).toBe(' data-tooltip="Say &quot;hi&quot;" data-tooltip-side="bottom"');
  });

  it('opens on keyboard focus with the Tooltip classes, Escape closes it', async () => {
    document.body.innerHTML = `<button type="button" aria-label="Copy token name"${tooltipHtmlAttributes('Copy token name')}>C</button>`;
    const stop = bindTooltips(document, { delay: 0 });
    const trigger = document.querySelector('button')!;
    const focusVisible = vi.spyOn(trigger, 'matches').mockImplementation((s: string) => s === ':focus-visible');
    trigger.focus();
    const popup = await waitFor(() => {
      const p = document.querySelector('[data-bridge-tooltip] .tooltip');
      expect(p).not.toBeNull();
      return p!;
    });
    expect(popup).toHaveTextContent('Copy token name');
    expect(popup.parentElement).toHaveClass('positioner');
    expect(trigger).toHaveAttribute('data-popup-open');
    expect(popup).toHaveAttribute('role', 'tooltip');
    expect(trigger).toHaveAccessibleDescription('Copy token name');
    await expectNoAxeViolations();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(trigger).not.toHaveAttribute('data-popup-open');
    expect(trigger).not.toHaveAttribute('aria-describedby');
    focusVisible.mockRestore();
    stop();
  });

  it('opens on hover after the delay, never on touch', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<span${tooltipHtmlAttributes('Approved by @ana', { focusable: true })}>${badgeHtml('Approved', { tone: 'success' })}</span>`;
    const stop = bindTooltips(document, { delay: 500 });
    const trigger = document.querySelector<HTMLElement>('[data-tooltip]')!;
    fireEvent.pointerOver(trigger, { pointerType: 'touch' });
    vi.advanceTimersByTime(600);
    expect(document.querySelector('[data-bridge-tooltip]')).toBeNull();
    fireEvent.pointerOver(trigger, { pointerType: 'mouse' });
    vi.advanceTimersByTime(400);
    expect(document.querySelector('[data-bridge-tooltip]')).toBeNull();
    vi.advanceTimersByTime(200);
    expect(document.querySelector('[data-bridge-tooltip] .tooltip')).toHaveTextContent('Approved by @ana');
    fireEvent.pointerOut(trigger, { pointerType: 'mouse' });
    expect(trigger).not.toHaveAttribute('data-popup-open');
    stop();
    vi.useRealTimers();
  });
});
