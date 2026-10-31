// @vitest-environment jsdom
// Start an exploration (StartExploration): the one way to start work in Studio, on the Changes header and the home.
// One question, where (a product or the library) and what; Report it stays a quiet way out; old ?start= addresses
// open it.
import '../../../../../../packages/react/src/test/setup';
import { createElement } from 'react';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../../../../../packages/react/src/test/axe';
import StartExploration, { startFromAddress } from './StartExploration';
import bridgeConfig from '../../../../../../bridge.config.json';

const components = [
  { name: 'Button', slug: 'button', family: 'Actions' },
  { name: 'Select', slug: 'select', family: 'Forms' },
];

afterEach(() => history.replaceState(null, '', '/'));

describe('Start an exploration', () => {
  it('is the Changes header action: one label, no type wizard, the library as a target', async () => {
    const user = userEvent.setup();
    render(createElement(StartExploration, { components }));
    await user.click(screen.getByRole('button', { name: 'Start an exploration' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('What do you want to explore?');
    for (const gone of ['What are you working on?', 'A change to the library', 'Adjust the look', 'Step 1 of 2']) expect(dialog.textContent).not.toContain(gone);
    expect(screen.getByRole('button', { name: 'Start with Claude AI' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    await user.click(screen.getByRole('combobox', { name: 'Where' }));
    const lib = await screen.findByRole('option', { name: /The library/ });
    expect(lib.textContent).toContain('Tokens, variants, new components');
    await expectNoAxeViolations(document.body);
  });

  it("offers the product admin and the library only with Bridge's own config, never the Admin demo", async () => {
    // The layout embeds the repository's settings (#bridge-repo): here, the products of this repository's config.
    const embed = document.createElement('script');
    embed.id = 'bridge-repo';
    embed.type = 'application/json';
    embed.textContent = JSON.stringify({ products: bridgeConfig.products });
    document.body.append(embed);
    try {
      const user = userEvent.setup();
      render(createElement(StartExploration, { components }));
      await user.click(screen.getByRole('button', { name: 'Start an exploration' }));
      await user.click(await screen.findByRole('combobox', { name: 'Where' }));
      await screen.findByRole('option', { name: /The library/ });
      const options = screen.getAllByRole('option').map((o) => o.textContent ?? '');
      expect(options).toHaveLength(2);
      expect(options[0]).toContain('Art print shop');
      expect(options[1]).toContain('The library');
      expect(options.join(' ')).not.toContain('Admin demo');
    } finally {
      embed.remove();
    }
  });

  it('keeps Something looks wrong as a quiet way out: the component, then its page on the report', async () => {
    const user = userEvent.setup();
    render(createElement(StartExploration, { components }));
    await user.click(screen.getByRole('button', { name: 'Start an exploration' }));
    await user.click(await screen.findByRole('button', { name: 'Something looks wrong? Report it' }));
    expect((await screen.findByRole('dialog')).textContent).toContain('Which component looks wrong?');
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('dialog').textContent).toContain('What do you want to explore?');
  });

  it('says the sentence is missing before anything starts', async () => {
    const user = userEvent.setup();
    render(createElement(StartExploration, { components }));
    await user.click(screen.getByRole('button', { name: 'Start an exploration' }));
    await user.click(await screen.findByRole('button', { name: 'Start with Claude AI' }));
    expect(screen.getByRole('dialog').textContent).toMatch(/Say what you want to explore/);
  });

  it('opens from an old ?start= address on the Changes page, the library picked for the old New component', async () => {
    expect(startFromAddress('?view=explorations&start=new')).toEqual({ target: 'library' });
    expect(startFromAddress('?start=1&product=admin')).toEqual({ target: 'admin' });
    expect(startFromAddress('?view=explorations&for=12&start=new')).toBeNull();
    expect(startFromAddress('?view=history')).toBeNull();
    history.replaceState(null, '', '/studio/changes/?view=explorations&start=new');
    render(createElement(StartExploration, { components }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('What do you want to explore?');
    expect(screen.getByRole('combobox', { name: 'Where' }).textContent).toContain('The library');
    // The address no longer asks: a reload does not open it again.
    expect(location.search).toBe('');
  });

  it('never opens from the address on the home cards', () => {
    history.replaceState(null, '', '/studio/?start=new');
    render(createElement(StartExploration, { components, appearance: 'card' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
