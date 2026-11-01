// @vitest-environment jsdom
// Start an exploration (StartExploration): the one way to start work in Studio, on the Changes header and the home.
// One question, where (a product or the library) and what; Report it stays a quiet way out; old ?start= addresses
// open it.
import '../../../../../../packages/react/src/test/setup';
import { createElement } from 'react';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../../../../../packages/react/src/test/axe';
import StartExploration, { startFromAddress } from './StartExploration';
import bridgeConfig from '../../../../../../bridge.config.json';

// The viewer's access to the team: a lead (GitHub write) by default; a test sets a designer of the team.
const viewer = vi.hoisted(() => ({ access: { state: 'writer', write: true, admin: false, contributor: false } as Record<string, unknown> | null }));
vi.mock('../../../scripts/github-session', async (actual) => ({
  ...(await actual<Record<string, unknown>>()),
  onAccess: (fn: (a: unknown) => void) => viewer.access && fn(viewer.access),
}));
// The session module is large: load it once before the tests, so the access arrives right after a dialog opens.
beforeAll(async () => {
  await import('../../../scripts/github-session');
}, 30_000);

const components = [
  { name: 'Button', slug: 'button', family: 'Actions' },
  { name: 'Select', slug: 'select', family: 'Forms' },
];

afterEach(() => {
  history.replaceState(null, '', '/');
  viewer.access = { state: 'writer', write: true, admin: false, contributor: false };
});

/** The repository's settings as the layout embeds them (#bridge-repo): this repository's products. */
function embedProducts(products: unknown = bridgeConfig.products): () => void {
  const embed = document.createElement('script');
  embed.id = 'bridge-repo';
  embed.type = 'application/json';
  embed.textContent = JSON.stringify({ products });
  document.body.append(embed);
  return () => embed.remove();
}

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
    await user.click(await screen.findByRole('combobox', { name: 'Where' }));
    const lib = await screen.findByRole('option', { name: /The library/ });
    expect(lib.textContent).toContain('Change a token, a component or its guidance in the design system.');
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

  it('on a product page, shows Where as a read-only line with the product, no Select listing the others', async () => {
    const embed = document.createElement('script');
    embed.id = 'bridge-repo';
    embed.type = 'application/json';
    embed.textContent = JSON.stringify({ products: bridgeConfig.products });
    document.body.append(embed);
    try {
      const user = userEvent.setup();
      const lib = render(createElement(StartExploration, { components, product: 'library' }));
      await user.click(await screen.findByRole('button', { name: 'Start an exploration' }));
      await screen.findByRole('dialog');
      expect(screen.queryByRole('combobox', { name: 'Where' })).toBeNull();
      const where = document.querySelector('[data-where-fixed]')!;
      expect(where.querySelector('dt')!.textContent).toBe('Where');
      expect(where.querySelector('dd')!.textContent).toBe('The libraryChange a token, a component or its guidance in the design system.');
      expect(screen.getByRole('dialog').textContent).not.toContain('Art print shop');
      await expectNoAxeViolations(document.body);
      await user.keyboard('{Escape}');
      lib.unmount();

      render(createElement(StartExploration, { components, product: 'admin-app' }));
      await user.click(screen.getByRole('button', { name: 'Start an exploration' }));
      await screen.findByRole('dialog');
      expect(screen.queryByRole('combobox', { name: 'Where' })).toBeNull();
      expect(document.querySelector('[data-where-fixed] dd')!.textContent).toBe('Art print shop');
    } finally {
      embed.remove();
    }
  });

  it('shows a designer of the team only the products: no library, no Where with one product, nothing on the library page', async () => {
    viewer.access = { state: 'writer', write: true, admin: false, contributor: true };
    const done = embedProducts();
    try {
      const user = userEvent.setup();
      const home = render(createElement(StartExploration, { components }));
      await user.click(screen.getByRole('button', { name: 'Start an exploration' }));
      const dialog = await screen.findByRole('dialog');
      // One product, no library: where is implied.
      expect(screen.queryByRole('combobox', { name: 'Where' })).toBeNull();
      expect(dialog.textContent).not.toContain('The library');
      await expectNoAxeViolations(document.body);
      await user.keyboard('{Escape}');
      home.unmount();

      // The library's own page: starting there is a lead's.
      render(createElement(StartExploration, { components, product: 'library' }));
      expect(screen.queryByRole('button', { name: 'Start an exploration' })).toBeNull();
    } finally {
      done();
    }
  });

  it('shows a designer of the team every product to pick from when there are several, still no library', async () => {
    viewer.access = { state: 'writer', write: true, admin: false, contributor: true };
    const done = embedProducts([...bridgeConfig.products, { key: 'checkout', name: 'Checkout', repo: 'acme/checkout' }]);
    try {
      const user = userEvent.setup();
      render(createElement(StartExploration, { components }));
      await user.click(screen.getByRole('button', { name: 'Start an exploration' }));
      await user.click(await screen.findByRole('combobox', { name: 'Where' }));
      await screen.findByRole('option', { name: /Checkout/ });
      const options = screen.getAllByRole('option').map((o) => o.textContent ?? '');
      expect(options).toHaveLength(2);
      expect(options.join(' ')).not.toContain('The library');
    } finally {
      done();
    }
  });

  it('gives an admin the library too, an email admin included', async () => {
    viewer.access = { state: 'writer', write: true, admin: true, contributor: true };
    const done = embedProducts();
    try {
      const user = userEvent.setup();
      render(createElement(StartExploration, { components }));
      await user.click(screen.getByRole('button', { name: 'Start an exploration' }));
      await user.click(await screen.findByRole('combobox', { name: 'Where' }));
      expect(await screen.findByRole('option', { name: /The library/ })).toBeTruthy();
    } finally {
      done();
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
    expect((await screen.findByRole('combobox', { name: 'Where' })).textContent).toContain('The library');
    // The address no longer asks: a reload does not open it again.
    expect(location.search).toBe('');
  });

  it('never opens from the address on the home cards', () => {
    history.replaceState(null, '', '/studio/?start=new');
    render(createElement(StartExploration, { components, appearance: 'card' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
