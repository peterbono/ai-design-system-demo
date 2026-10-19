// Dialog outside React: parity of dialogHtml() with <DialogContent>, and the Base UI behavior bindDialogs() gives it.
import { renderToStaticMarkup } from 'react-dom/server';
import { fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../test/axe';
import { Button } from '../components/Button';
import { Dialog, DialogContent, type DialogContentProps } from '../components/Dialog';
import { bindDialogs, closeDialog, dialogHtml, dialogReturnValue, isDialogOpen, openDialog, trusted, type DialogHtmlOptions } from './index';

/** Elements, classes, text and the attributes users and assistive tech see; ids and framework internals dropped. */
function shape(el: Element): string {
  const keep = ['role', 'type', 'aria-label', 'aria-hidden'];
  const a = keep.filter((n) => el.hasAttribute(n)).map((n) => ` ${n}="${el.getAttribute(n)}"`);
  const cls = el.getAttribute('class');
  const kids = [...el.childNodes].map((n) => (n.nodeType === 3 ? n.textContent : n instanceof Element ? shape(n) : '')).join('');
  return `<${el.tagName.toLowerCase()}${cls ? ` class="${cls}"` : ''}${a.join('')}>${kids}</${el.tagName.toLowerCase()}>`;
}

const reactDialog = async (props: Omit<DialogContentProps, 'title'> & { title: string }) => {
  const r = render(
    <Dialog defaultOpen>
      <DialogContent {...props} />
    </Dialog>,
  );
  const popup = await r.findByRole('dialog');
  const out = {
    popup: shape(popup),
    backdrop: document.querySelector('.backdrop')!.getAttribute('class'),
    viewport: popup.parentElement!.getAttribute('class'),
    name: popup.getAttribute('aria-labelledby') ? document.getElementById(popup.getAttribute('aria-labelledby')!)!.textContent : null,
    description: popup.getAttribute('aria-describedby') ? document.getElementById(popup.getAttribute('aria-describedby')!)!.textContent : null,
  };
  r.unmount();
  return out;
};

const domDialog = (opts: DialogHtmlOptions) => {
  document.body.innerHTML = dialogHtml(opts);
  const popup = document.querySelector('[role="dialog"]')!;
  const out = {
    popup: shape(popup),
    backdrop: document.querySelector('[data-dialog-backdrop]')!.getAttribute('class'),
    viewport: popup.parentElement!.getAttribute('class'),
    name: document.getElementById(popup.getAttribute('aria-labelledby')!)!.textContent,
    description: popup.getAttribute('aria-describedby') ? document.getElementById(popup.getAttribute('aria-describedby')!)!.textContent : null,
  };
  document.body.innerHTML = '';
  return out;
};

afterEach(() => {
  for (const el of document.querySelectorAll('[data-bridge-dialog]')) closeDialog(el as HTMLElement);
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('dialogHtml', () => {
  const footer = <Button variant="primary">Save</Button>;
  const footerHtml = renderToStaticMarkup(footer);
  it.each([
    [{ title: 'New token' }, {}],
    [{ title: 'New token', description: 'Pick a name & a value.', children: <p>Body</p>, footer }, { body: '<p>Body</p>', footer: footerHtml }],
    [{ title: 'Send for review', size: 'lg' as const, hideClose: true, children: <p>x</p> }, { body: '<p>x</p>' }],
    [{ title: 'Connect GitHub', size: 'sm' as const, closeLabel: 'Close', className: 'gh', footer }, { footer: footerHtml }],
  ] as Array<[DialogContentProps & { title: string }, { body?: string; footer?: string }]>)('matches <DialogContent %j>', async (props, html) => {
    const { children: _c, footer: _f, ...rest } = props as DialogContentProps & { title: string };
    const react = await reactDialog(props as DialogContentProps & { title: string });
    const dom = domDialog({
      id: 'd',
      ...(rest as Omit<DialogHtmlOptions, 'id'>),
      ...(html.body ? { body: trusted(html.body) } : {}),
      ...(html.footer ? { footer: trusted(html.footer) } : {}),
    });
    expect(dom).toEqual(react);
  });

  it('is hidden until opened, modal, named and described', () => {
    document.body.innerHTML = dialogHtml({ id: 'new-token', title: 'New token', description: 'Pick a name.' });
    const root = document.getElementById('new-token')!;
    expect(root).toHaveAttribute('hidden');
    const popup = root.querySelector('[role="dialog"]')!;
    expect(popup).toHaveAttribute('aria-modal', 'true');
    expect(popup).toHaveAccessibleName('New token');
    expect(popup).toHaveAccessibleDescription('Pick a name.');
  });

  it('escapes the title and passes trusted markup through', () => {
    const html = dialogHtml({ id: 'x', title: 'A <b> c', description: trusted('<em>ok</em>') });
    expect(html).toContain('A &lt;b&gt; c');
    expect(html).toContain('<em>ok</em>');
  });
});

describe('bindDialogs', () => {
  const page = (extra: Partial<DialogHtmlOptions> = {}) => {
    document.body.innerHTML =
      `<main><button type="button" data-dialog-open="nt">New token</button><a href="#x">Elsewhere</a></main>` +
      dialogHtml({
        id: 'nt',
        title: 'New token',
        body: trusted('<form method="dialog" id="nt-form"><label>Name <input name="n" /></label></form>'),
        footer: trusted('<button type="button" data-dialog-close="">Cancel</button><button type="submit" form="nt-form" value="create">Create</button>'),
        ...extra,
      });
    bindDialogs();
    return {
      trigger: document.querySelector<HTMLButtonElement>('[data-dialog-open]')!,
      root: document.getElementById('nt')!,
      main: document.querySelector('main')!,
    };
  };

  it('opens from a trigger: focus inside, page inert, scroll locked, no axe violations', async () => {
    const { trigger, root, main } = page();
    trigger.focus();
    fireEvent.click(trigger);
    expect(isDialogOpen('nt')).toBe(true);
    expect(root).not.toHaveAttribute('hidden');
    expect(root.querySelector('[role="dialog"]')).toHaveAttribute('data-open');
    expect(document.activeElement).toBe(root.querySelector('input'));
    expect(main.inert).toBe(true);
    expect(document.documentElement.style.overflow).toBe('hidden');
    await expectNoAxeViolations();
  });

  it('focuses the first action, never the header close button, when the body has no field', () => {
    document.body.innerHTML = dialogHtml({ id: 'undo', title: 'Undo this change', footer: trusted('<button type="button" data-dialog-close="">Cancel</button><button type="button">Propose undo</button>') });
    openDialog('undo');
    expect(document.activeElement).toHaveTextContent('Cancel');
  });

  it('Escape closes it, returns focus to the trigger, unlocks the page and fires cancel then close', () => {
    const { trigger, root, main } = page();
    const events: string[] = [];
    root.addEventListener('cancel', () => events.push('cancel'));
    root.addEventListener('close', () => events.push('close'));
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(isDialogOpen('nt')).toBe(false);
    expect(events).toEqual(['cancel', 'close']);
    expect(document.activeElement).toBe(trigger);
    expect(main.inert).toBe(false);
    expect(document.documentElement.style.overflow).toBe('');
  });

  it('a cancel listener that calls preventDefault keeps it open', () => {
    const { trigger, root } = page();
    root.addEventListener('cancel', (e) => e.preventDefault());
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(isDialogOpen(root)).toBe(true);
  });

  it('traps Tab inside the popup, both ways', () => {
    const { trigger, root } = page();
    fireEvent.click(trigger);
    const input = root.querySelector('input')!;
    const close = root.querySelector<HTMLElement>('[aria-label="Close dialog"]')!;
    close.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(close);
  });

  it('closes on the scrim, on the close button, and not on the scrim when pointer dismissal is off', () => {
    const { trigger, root } = page();
    fireEvent.click(trigger);
    fireEvent.click(root.querySelector('[data-dialog-viewport]')!);
    expect(isDialogOpen(root)).toBe(false);
    fireEvent.click(trigger);
    fireEvent.click(root.querySelector('[aria-label="Close dialog"]')!);
    expect(isDialogOpen(root)).toBe(false);
    closeDialog(root);
    const again = page({ disablePointerDismissal: true });
    fireEvent.click(again.trigger);
    fireEvent.click(again.root.querySelector('[data-dialog-viewport]')!);
    expect(isDialogOpen(again.root)).toBe(true);
  });

  it('a method="dialog" form closes it with the submit button value', () => {
    const { trigger, root } = page();
    fireEvent.click(trigger);
    const create = root.querySelector<HTMLButtonElement>('button[value="create"]')!;
    create.click();
    expect(isDialogOpen(root)).toBe(false);
    expect(dialogReturnValue(root)).toBe('create');
  });

  it('opens and closes from script, hides after the exit transition', () => {
    vi.useFakeTimers();
    const { root } = page();
    openDialog('nt');
    expect(isDialogOpen(root)).toBe(true);
    closeDialog('nt', 'done');
    expect(dialogReturnValue('nt')).toBe('done');
    expect(root.querySelector('[role="dialog"]')).toHaveAttribute('data-ending-style');
    vi.advanceTimersByTime(300);
    expect(root).toHaveAttribute('hidden');
  });
});
