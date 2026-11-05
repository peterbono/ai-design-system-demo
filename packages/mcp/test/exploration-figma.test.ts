// bridge_exploration_to_figma: what Claude gets to rebuild an exploration in Figma through its own connector. Reads
// only. Linked, not linked, no Figma file, the design team's private copy, a Reader, and the ids of another file.
import { describe, expect, it } from 'vitest';
import { BridgeContext, explorationFigma, explorations } from '../dist/lib.js';
import { fakeGitHub, readTree, REAL_PATHS, REPO } from './helpers.js';

const FILE = 'AbCdEf0123456789XyZ';
const OTHER = 'ZyXwVu9876543210AbC';
const SCREEN = `import { Alert, Button, Card, CardBody, Link, useToast } from '@bridge-ds/react';
import type { ButtonProps } from '@bridge-ds/react';
import { StatCard } from '../../ui';
import type { Order } from '../../types';
export function Dashboard() {
  const orders = useGetList<Order>('orders');
  return (
    <Card>
      <CardBody>
        <StatCard />
        <Alert tone="warning" actions={<Button variant="secondary">See orders</Button>} />
        <Link href="/x">More</Link>
      </CardBody>
    </Card>
  );
}
`;

const MAP = {
  version: 1,
  components: {
    Alert: { figma: { file: FILE, node: '1:2', name: 'Alert', properties: { Tone: { prop: 'tone', values: { Warning: 'warning' } } } } },
    Button: { figma: { file: OTHER, key: 'k-button', node: '3:4' } },
    Card: { figma: { file: OTHER, node: '5:6' } },
  },
};

function setup(opts: { figma?: boolean; map?: boolean; identity?: () => Promise<any>; privateCopy?: boolean; noted?: boolean } = {}) {
  const tree = readTree(REPO, REAL_PATHS);
  const cfg = JSON.parse(tree['bridge.config.json']!);
  cfg.products = [
    { key: 'shop', name: 'Shop', repo: 'acme/shop', design: { repo: 'acme/shop-design', preview: 'https://{branch}.shop-design.pages.dev' }, preview: 'https://{branch}.shop.pages.dev' },
    { key: 'library', name: 'Library', default: true },
  ];
  if (opts.figma !== false) cfg.figma = { file: `https://www.figma.com/design/${FILE}/Library` };
  const files: Record<string, string> = { ...tree, 'bridge.config.json': `${JSON.stringify(cfg, null, 2)}\n` };
  if (opts.map !== false) files['bridge.components.json'] = `${JSON.stringify(MAP, null, 2)}\n`;
  const ds = fakeGitHub('acme', 'ds', files);
  const copy = fakeGitHub('acme', 'shop-design', { 'package.json': '{"name":"shop"}', 'src/Dashboard.tsx': 'export const Dashboard = () => null;\n' });
  const dev = fakeGitHub('acme', 'shop', {});
  const main = copy.refs.get('main')!;
  const c = copy.id();
  const note = opts.noted ? '# Exploration\n\n## In Figma\n\nhttps://www.figma.com/design/x/?node-id=24-5\n' : '# Exploration\n';
  copy.commits.set(c, { files: new Map([...copy.commits.get(main)!.files, ['.bridge/explorations/orders.md', note], ['src/Dashboard.tsx', SCREEN]]), parents: [main] });
  copy.refs.set('explore/orders', c);
  const body = `## Exploration: Orders\n\n<!-- bridge-exploration ${JSON.stringify({ name: 'Orders', purpose: '', slug: 'orders', author: 'dino' })} -->`;
  copy.pulls.push({ number: 1, node_id: 'PR_1', title: 'Exploration: Orders', body, state: 'open', draft: true, user: { login: 'app' }, head: { ref: 'explore/orders', sha: c }, base: { ref: 'main' }, labels: [{ name: 'exploration' }] });
  const fetch = ((url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('/repos/acme/shop-design')) return opts.privateCopy ? Promise.resolve(new Response('{"message":"Not Found"}', { status: 404 })) : copy.fetch(url, init);
    if (u.includes('/repos/acme/shop')) return dev.fetch(url, init);
    return ds.fetch(url, init);
  }) as typeof globalThis.fetch;
  return { copy, dev, ctx: () => BridgeContext.create({ repo: 'acme/ds', token: 't', fetch, ...(opts.identity ? { identity: opts.identity } : {}) }) };
}

describe('bridge_exploration_to_figma', () => {
  it('gives the file, the page, the screens, each linked component with how to reach it, and the recipe', async () => {
    const { copy, dev, ctx } = setup();
    const before = copy.log.filter((l) => l.method !== 'GET').length;
    const r = (await explorationFigma.explorationToFigma(await ctx(), { ref: 'Put Bridge exploration shop#1 "Orders" in Figma.' })) as any;
    expect(r).toMatchObject({ status: 'ready', ref: 'shop#1', name: 'Orders', product: 'Shop', page: 'Exploration: Orders' });
    expect(r.figma.file).toBe(FILE);
    expect(r.screens[0]).toMatchObject({ path: 'src/Dashboard.tsx', status: 'changed', source: SCREEN });
    expect(r.screens[0].baseSource).toContain('=> null');
    expect(r.screens.some((s: any) => s.path.startsWith('.bridge/'))).toBe(false);
    // The part names the component it belongs to; a hook and a type are not components.
    expect(r.components.map((c: any) => c.name)).toEqual(['Alert', 'Button']);
    const alert = r.components[0];
    expect(alert.figma).toMatchObject({ node: '1:2', reach: 'node id: getNodeByIdAsync', properties: { Tone: { prop: 'tone' } } });
    expect(alert.figma.key).toBeUndefined();
    // In another file, only the key reaches it.
    expect(r.components[1].figma.reach).toMatch(/^key/);
    expect(r.fileRule).toMatch(/1 linked component lives in another file/);
    expect(r.fileRule).toMatch(/published Library/);
    const unlinked = Object.fromEntries(r.notLinked.map((c: any) => [c.name, c]));
    expect(unlinked.Card.why).toMatch(/another Figma file with no key/);
    expect(unlinked.Card.usedAs).toEqual(['Card', 'CardBody']);
    expect(unlinked.Link.why).toBe('Not linked to Figma yet.');
    expect(r.productComponents).toEqual([{ name: 'StatCard', files: ['src/Dashboard.tsx'] }]);
    expect(r.gaps.join(' ')).toContain('StatCard');
    const recipe = r.recipe.join(' ');
    for (const word of ['figma.createPage()', 'setCurrentPageAsync', 'getNodeByIdAsync', 'createInstance()', 'then set FILL', 'loadFontAsync', 'closest variant', 'child.visible = false', '1440', 'Never touch the page that holds the components']) expect(recipe).toContain(word);
    expect(r.previewNote).toMatch(/never invent content/);
    expect(recipe).toContain('Never make up realistic data');
    expect(r.next).toContain('bridge_save_exploration');
    // Reads only, and only the design team's copy: the developers' repository is never read for the exploration.
    expect(copy.log.filter((l) => l.method !== 'GET').length).toBe(before);
    expect(dev.log).toHaveLength(0);
  });

  it('reads the design team\'s copy: its preview, and the page already recorded', async () => {
    const { ctx } = setup({ noted: true });
    const r = (await explorationFigma.explorationToFigma(await ctx(), { ref: 'shop#1' })) as any;
    expect(r.preview).toContain('shop-design.pages.dev');
    expect(r.alreadyInFigma).toBe('https://www.figma.com/design/x/?node-id=24-5');
  });

  it('nothing linked yet: every component is listed, and Claude tells the designer who links them', async () => {
    const { ctx } = setup({ map: false });
    const r = (await explorationFigma.explorationToFigma(await ctx(), { ref: 'shop#1' })) as any;
    expect(r.components).toEqual([]);
    expect(r.notLinked.map((c: any) => c.name)).toEqual(['Alert', 'Button', 'Card', 'CardBody', 'Link']);
    expect(r.next).toContain('Link our Library components to Figma with Bridge');
  });

  it('no Figma file: one sentence for the designer, pointing to Settings, and nothing read', async () => {
    const { copy, ctx } = setup({ figma: false });
    const r = (await explorationFigma.explorationToFigma(await ctx(), { ref: 'shop#1' })) as any;
    expect(r.status).toBe('no-figma-file');
    expect(r.say).toContain('Settings, Figma file');
    expect(copy.log).toHaveLength(0);
  });

  it('a private design copy Bridge cannot read: says who fixes it, in plain words', async () => {
    const { ctx } = setup({ privateCopy: true });
    await expect(explorationFigma.explorationToFigma(await ctx(), { ref: 'shop#1' })).rejects.toThrow(/Bridge cannot read this exploration in acme\/shop-design\. Ask an admin to connect Shop/);
  });

  it('a Reader changes nothing: refused; Can edit through email goes on', async () => {
    const reader = setup({ identity: async () => ({ name: 'Rae', role: 'Reader', via: 'email', team: 'Acme', writes: 'none' }) });
    await expect(explorationFigma.explorationToFigma(await reader.ctx(), { ref: 'shop#1' })).rejects.toThrow(/Ask an admin for Can edit/);
    const editor = setup({ identity: async () => ({ name: 'Dino', role: 'Can edit', via: 'email', team: 'Acme', writes: 'bridge' }) });
    expect(((await explorationFigma.explorationToFigma(await editor.ctx(), { ref: 'shop#1' })) as any).status).toBe('ready');
  });

  it('saves the page link in the notes, and refuses anything but a Figma link', async () => {
    const { copy, ctx } = setup();
    const c = await ctx();
    const link = 'https://www.figma.com/design/AbCdEf/?node-id=24-5';
    const r = (await explorations.saveExploration(c, { ref: 'shop#1', message: 'Put it in Figma', notes: { figmaPage: link } })) as any;
    expect(r.notes.figmaPage).toBe(link);
    expect(copy.fileAt('explore/orders', '.bridge/explorations/orders.md')).toContain(`## In Figma\n\n${link}`);
    await expect(explorations.saveExploration(c, { ref: 'shop#1', message: 'x', notes: { figmaPage: 'https://evil.example/x' } })).rejects.toThrow(/figma\.com link/);
  });

  it('reads the parts of the Library and the line Studio hands over', () => {
    expect(explorationFigma.libraryComponentOf('AlertDialogContent', ['Alert', 'AlertDialog', 'Dialog'])).toBe('AlertDialog');
    expect(explorationFigma.libraryComponentOf('Cardinal', ['Card'])).toBeNull();
    expect(explorationFigma.figmaRefOf('Put Bridge exploration admin-app#1 "Dashboard: orders" in Figma.')).toBe('admin-app#1');
    expect(explorationFigma.figmaRefOf('Put Bridge exploration #12 in Figma')).toBe('#12');
    expect(explorationFigma.figmaPageName('Exploration: Orders')).toBe('Exploration: Orders');
  });
});
