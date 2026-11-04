// @vitest-environment jsdom
// Start an exploration (StartExploration): the one way to start work in Studio, on the Changes header and the home.
// One question, where (a product or the library) and what; Report it stays a quiet way out; old ?start= addresses
// open it.
import '../../../../../../packages/react/src/test/setup';
import { createElement } from 'react';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../../../../../packages/react/src/test/axe';
import StartExploration, { startFromAddress, startLines } from './StartExploration';
import * as session from '../../../scripts/github-session';
import bridgeConfig from '../../../../../../bridge.config.json';

// The products this repository ships with. Admins and leads add others from Studio straight to bridge.config.json on
// main (Add a product): that is the team's live data, so these tests never pin it.
const OWN_PRODUCTS = bridgeConfig.products.filter((p) => ['admin-app', 'library'].includes(p.key));

// The viewer's access to the team: a lead (GitHub write) by default; a test sets a designer of the team.
const viewer = vi.hoisted(() => ({ access: { state: 'writer', write: true, admin: false, contributor: false } as Record<string, unknown> | null }));
// A spied module, never a factory mock: Vitest hands a factory mock's later dynamic imports the real module when two of
// them from one file overlap (a component still loading from the test before, the next test's own), and the real
// onAccess never answers, so Where never came. A spied module is one object for every import.
vi.mock('../../../scripts/github-session', { spy: true });
beforeEach(() => {
  vi.mocked(session.onAccess).mockImplementation((fn) => {
    if (viewer.access) fn(viewer.access as unknown as session.RepoAccess);
  });
});

const components = [
  { name: 'Button', slug: 'button', family: 'Actions' },
  { name: 'Select', slug: 'select', family: 'Forms' },
];

afterEach(() => {
  history.replaceState(null, '', '/');
  viewer.access = { state: 'writer', write: true, admin: false, contributor: false };
});

/** The repository's settings as the layout embeds them (#bridge-repo): this repository's products. */
function embedProducts(products: unknown = OWN_PRODUCTS): () => void {
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
    embed.textContent = JSON.stringify({ products: OWN_PRODUCTS });
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
    embed.textContent = JSON.stringify({ products: OWN_PRODUCTS });
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
    const done = embedProducts([...OWN_PRODUCTS, { key: 'checkout', name: 'Checkout', repo: 'acme/checkout' }]);
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

describe('Where: Add a product, for the people who may add one', () => {
  const admin = { state: 'admin', write: true, admin: true, contributor: false };
  /** The repository's settings as the layout embeds them, with an owner and a repository (the sample team's, say). */
  const embed = (site: Record<string, unknown>) => {
    const el = document.createElement('script');
    el.id = 'bridge-repo';
    el.type = 'application/json';
    el.textContent = JSON.stringify({ products: OWN_PRODUCTS, ...site });
    document.body.append(el);
    return () => el.remove();
  };
  const openWhere = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole('button', { name: 'Start an exploration' }));
    // The access (and with it the library and Add a product) arrives just after the dialog opens.
    await user.click(await screen.findByRole('combobox', { name: 'Where' }));
  };

  it('an admin gets "Add a product" last, after a separator, and it opens the Add a product dialog', async () => {
    viewer.access = admin;
    const done = embed({ owner: 'acme', repo: 'ds' });
    try {
      const user = userEvent.setup();
      render(createElement(StartExploration, { components }));
      await openWhere(user);
      const add = await screen.findByRole('option', { name: 'Add a product' });
      const options = screen.getAllByRole('option');
      expect(options[options.length - 1]).toBe(add);
      // The separator sets it apart from the places to start.
      expect(add.previousElementSibling?.getAttribute('data-orientation')).toBe('horizontal');
      expect(add.querySelector('.addp-option-mark svg')).toBeTruthy();
      await user.click(add);
      expect(await screen.findByRole('dialog', { name: 'Add a product' })).toBeTruthy();
      // Not a place to start: the exploration's own dialog stepped aside, nothing was picked.
      expect(screen.queryByText('What do you want to explore?')).toBeNull();
    } finally {
      done();
    }
  });

  it('a lead who is not an admin, a designer and the sample team never see it', async () => {
    const cases: { access: Record<string, unknown>; site: Record<string, unknown> }[] = [
      { access: { state: 'writer', write: true, admin: false, contributor: false }, site: { owner: 'acme', repo: 'ds' } },
      { access: admin, site: { owner: 'peterbono', repo: 'bridge-demo-ds' } },
    ];
    for (const c of cases) {
      viewer.access = c.access;
      const done = embed(c.site);
      const user = userEvent.setup();
      const { unmount } = render(createElement(StartExploration, { components }));
      try {
        await openWhere(user);
        expect((await screen.findAllByRole('option')).length).toBeGreaterThan(0);
        expect(screen.queryByRole('option', { name: 'Add a product' })).toBeNull();
      } finally {
        unmount();
        done();
      }
    }
  });
});

describe('the lines of the last step', () => {
  it('gives the Claude app the connector line, the terminal and Copilot the full one', () => {
    const full = 'Open Bridge exploration admin-app#4 "add a toast alert" in the design team\'s copy of Art print shop (acme/shop-design, branch explore/add-a-toast-alert) and use the Bridge library. I\'ll tell you what to explore.';
    const app = 'Open Bridge exploration admin-app#4 "add a toast alert" and use the Bridge library. I\'ll tell you what to explore.';
    const lines = startLines(full, app);
    expect(lines['claude-app']).toBe(app);
    expect(lines.copilot).toBe(full);
    expect(lines['claude-code']).toContain('branch explore/add-a-toast-alert');
    // No connector line: every tool gets the one line.
    expect(startLines(full)['claude-app']).toBe(full);
  });
});
