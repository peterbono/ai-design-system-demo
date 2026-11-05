// bridge_save_exploration: Claude saves prototype code on an exploration through Bridge (no git push of its own),
// one commit on the explore/ branch, fast-forwarded; refusals in plain words; the instructions say to use it.
import { describe, expect, it } from 'vitest';
import { BridgeContext, explorations } from '../dist/lib.js';
import { fakeGitHub, readTree, REAL_PATHS, REPO } from './helpers.js';

function setup() {
  const tree = readTree(REPO, REAL_PATHS);
  const cfg = JSON.parse(tree['bridge.config.json']!);
  cfg.products = [
    { key: 'shop', name: 'Shop', repo: 'acme/shop', preview: 'https://shop-git-{branch}-acme.vercel.app' },
    { key: 'library', name: 'Library', default: true },
  ];
  const ds = fakeGitHub('acme', 'ds', { ...tree, 'bridge.config.json': `${JSON.stringify(cfg, null, 2)}\n` });
  const shop = fakeGitHub('acme', 'shop', { 'package.json': '{"name":"shop"}', 'src/orders/OrderList.tsx': 'export const OrderList = () => null;\n', 'src/old.ts': 'old\n' });
  const fetch = ((url: string, init?: RequestInit) => (String(url).includes('/repos/acme/shop') ? shop.fetch(url, init) : ds.fetch(url, init))) as typeof globalThis.fetch;
  const rw = () => BridgeContext.create({ repo: 'acme/ds', token: 't', fetch });
  const main = shop.refs.get('main')!;
  const c = shop.id();
  shop.commits.set(c, { files: new Map([...shop.commits.get(main)!.files, ['.bridge/explorations/order-toast.md', '# Exploration\n']]), parents: [main] });
  shop.refs.set('explore/order-toast', c);
  const body = `## Exploration: Order toast\n\n<!-- bridge-exploration ${JSON.stringify({ name: 'Order toast', purpose: '', slug: 'order-toast', author: 'dino' })} -->`;
  shop.pulls.push({ number: 1, node_id: 'PR_1', title: 'Exploration: Order toast', body, state: 'open', draft: true, user: { login: 'app' }, head: { ref: 'explore/order-toast', sha: c }, base: { ref: 'main' }, labels: [{ name: 'exploration' }, { name: 'product: shop' }], html_url: 'https://github.com/acme/shop/pull/1', updated_at: '2026-11-01T00:00:00Z' });
  return { shop, rw, start: c };
}

describe('bridge_save_exploration', () => {
  it('saves every file in one commit on the explore/ branch, fast-forwarded, and says where to look', async () => {
    const { shop, rw, start } = setup();
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64');
    const r = await explorations.saveExploration(await rw(), {
      ref: 'shop#1',
      message: 'Orders: success toast when an order ships',
      files: [
        { path: 'src/orders/OrderList.tsx', content: 'export const OrderList = () => <Toast />;\n' },
        { path: './src/orders/ship.png', contentBase64: png },
        { path: 'src/old.ts', delete: true },
      ],
    });
    expect(r).toMatchObject({ status: 'saved', ref: 'shop#1', branch: 'explore/order-toast', saved: 2, removed: 1, preview: 'https://shop-git-explore-order-toast-acme.vercel.app/' });
    expect(r.next).toContain('The preview updates in a few minutes');
    const head = shop.refs.get('explore/order-toast')!;
    expect(head).toBe(r.commit);
    expect(shop.commits.get(head)!.parents).toEqual([start]);
    expect(shop.fileAt('explore/order-toast', 'src/orders/OrderList.tsx')).toContain('<Toast />');
    expect(shop.fileAt('explore/order-toast', 'src/orders/ship.png')).toBe(Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('latin1'));
    expect(shop.fileAt('explore/order-toast', 'src/old.ts')).toBeUndefined();
    expect(shop.refs.get('main')).not.toBe(head);
    // Never forced, and the message is the one given.
    const moves = shop.log.filter((l) => l.method === 'PATCH' && l.path.startsWith('/git/refs/heads/'));
    expect(moves).toHaveLength(1);
    expect(moves[0]!.body).toMatchObject({ force: false });
    expect(shop.log.find((l) => l.method === 'POST' && l.path === '/git/commits')!.body.message).toBe('Orders: success toast when an order ships');
  });

  it('refuses CI, hosting settings, node_modules, paths outside the repository and unclear entries, before any write', async () => {
    const { shop, rw } = setup();
    const ctx = await rw();
    const save = (files: any[]) => explorations.saveExploration(ctx, { ref: 'shop#1', message: 'x', files });
    await expect(save([{ path: '.github/workflows/ci.yml', content: 'on: push' }])).rejects.toThrow(/CI settings/);
    await expect(save([{ path: 'vercel.json', content: '{}' }])).rejects.toThrow(/hosting settings/);
    await expect(save([{ path: 'apps/web/.vercel/project.json', content: '{}' }])).rejects.toThrow(/hosting settings/);
    await expect(save([{ path: 'node_modules/x/index.js', content: '' }])).rejects.toThrow(/node_modules/);
    await expect(save([{ path: '../outside.ts', content: '' }])).rejects.toThrow(/not a file path inside the repository/);
    await expect(save([{ path: '/etc/passwd', content: '' }])).rejects.toThrow(/not a file path inside the repository/);
    await expect(save([{ path: 'a.ts', content: 'a', delete: true }])).rejects.toThrow(/one of them/);
    await expect(save([{ path: 'a.ts', content: 'a' }, { path: 'a.ts', content: 'b' }])).rejects.toThrow(/listed twice/);
    await expect(save([])).rejects.toThrow(/Nothing to save/);
    await expect(save(Array.from({ length: 201 }, (_, i) => ({ path: `f${i}.ts`, content: '' })))).rejects.toThrow(/Too many files/);
    await expect(save([{ path: 'big.txt', content: 'x'.repeat(2_000_001) }])).rejects.toThrow(/2 MB at most/);
    await expect(explorations.saveExploration(ctx, { ref: 'shop#1', message: '  ', files: [{ path: 'a.ts', content: 'a' }] })).rejects.toThrow(/Say what this step changes/);
    expect(shop.log.filter((l) => l.method !== 'GET')).toHaveLength(0);
  });

  it('only saves on an open exploration branch, never main', async () => {
    const { shop, rw } = setup();
    const ctx = await rw();
    await expect(explorations.saveExploration(ctx, { ref: 'main', message: 'x', files: [{ path: 'a.ts', content: 'a' }] })).rejects.toThrow(/not an exploration branch/);
    shop.pulls[0]!.state = 'closed';
    await expect(explorations.saveExploration(ctx, { ref: 'shop#1', message: 'x', files: [{ path: 'a.ts', content: 'a' }] })).rejects.toThrow(/closed/);
  });

  it('Continue tells Claude to save through Bridge, git push only with its own access', async () => {
    const { rw } = setup();
    const r = await explorations.continueExploration(await rw(), { ref: 'shop#1', checkout: false });
    expect(r.next).toContain('bridge_save_exploration');
    expect(r.next).toContain('use git push only if you have your own access');
    expect(r.next).toContain('data-bridge-change');
    expect(explorations.SAVE_RULE).toMatch(/^Save your changes with bridge_save_exploration/);
  });

  it('merges notes into the note file in the same commit, keeping what a person wrote', async () => {
    const { shop, rw } = setup();
    const ctx = await rw();
    const path = '.bridge/explorations/order-toast.md';
    // A person wrote a decision by hand on the branch.
    await explorations.saveExploration(ctx, { ref: 'shop#1', message: 'notes by hand', files: [{ path: 'src/a.ts', content: 'a' }] });
    const handWritten = `${shop.fileAt('explore/order-toast', path)}\n## Decisions\n\nWe keep the toast top right.\n`;
    await explorations.saveExploration(ctx, { ref: 'shop#1', message: 'hand', files: [{ path: 'src/b.ts', content: 'b' }] });
    const c = shop.id();
    const head = shop.refs.get('explore/order-toast')!;
    shop.commits.set(c, { files: new Map([...shop.commits.get(head)!.files, [path, handWritten]]), parents: [head] });
    shop.refs.set('explore/order-toast', c);
    const before = shop.log.filter((l) => l.method === 'POST' && l.path === '/git/commits').length;
    const r = (await explorations.saveExploration(ctx, {
      ref: 'shop#1',
      message: 'Orders: toast on ship',
      files: [{ path: 'src/orders/OrderList.tsx', content: 'x' }],
      notes: { decisions: ['Toast stays 5 s'], edgeCases: [{ component: 'Toast', state: 'Long text', covered: false, note: 'wraps badly' }], nextStep: 'Fix the long text.' },
    })) as any;
    expect(shop.log.filter((l) => l.method === 'POST' && l.path === '/git/commits').length).toBe(before + 1);
    const md = shop.fileAt('explore/order-toast', path)!;
    expect(md).toContain('# Exploration');
    expect(md).toContain('We keep the toast top right.');
    expect(md).toContain('- Toast stays 5 s');
    expect(md).toContain('### Toast\n\n- [ ] Long text: wraps badly');
    expect(md).toContain('## Next step\n\nFix the long text.');
    expect(shop.fileAt('explore/order-toast', 'src/orders/OrderList.tsx')).toBe('x');
    expect(r.saved).toBe(2);
    expect(r.notes).toMatchObject({ nextStep: 'Fix the long text.', counts: { decisions: 2, edgeCases: 1, covered: 0 } });
    expect(r.next).not.toContain('update the notes too');
  });

  it('saves notes alone, refuses the note file sent as a file, and says when nothing changed', async () => {
    const { shop, rw } = setup();
    const ctx = await rw();
    const r = (await explorations.saveExploration(ctx, { ref: 'shop#1', message: 'Notes: next step', notes: { nextStep: 'Try the empty state.' } })) as any;
    expect(r).toMatchObject({ status: 'saved', saved: 1 });
    expect(shop.fileAt('explore/order-toast', '.bridge/explorations/order-toast.md')).toContain('## Next step\n\nTry the empty state.');
    await expect(explorations.saveExploration(ctx, { ref: 'shop#1', message: 'x', notes: { nextStep: 'Try the empty state.' } })).rejects.toThrow(/Nothing changed/);
    await expect(explorations.saveExploration(ctx, { ref: 'shop#1', message: 'x', files: [{ path: '.bridge/explorations/order-toast.md', content: '' }], notes: { nextStep: 'y' } })).rejects.toThrow(/send them in notes/);
    await expect(explorations.saveExploration(ctx, { ref: 'shop#1', message: 'x', files: [] })).rejects.toThrow(/Nothing to save/);
    // A save without notes reminds Claude to keep them.
    const plain = (await explorations.saveExploration(ctx, { ref: 'shop#1', message: 'x', files: [{ path: 'src/a.ts', content: 'a' }] })) as any;
    expect(plain.next).toContain('update the notes too');
  });

  it('Continue returns the notes and says to start from the next step; Done exploring hands them as the spec', async () => {
    const { shop, rw } = setup();
    const ctx = await rw();
    const empty = (await explorations.continueExploration(ctx, { ref: 'shop#1', checkout: false })) as any;
    expect(empty.notes.empty).toBe(true);
    expect(empty.next).not.toContain('Read notes first');
    await explorations.saveExploration(ctx, {
      ref: 'shop#1',
      message: 'Toast',
      files: [{ path: 'src/orders/OrderList.tsx', content: 'x' }],
      notes: { decisions: ['Toast stays 5 s'], edgeCases: [{ component: 'Toast', state: 'Long text', covered: true, note: 'wraps' }], openQuestions: ['Sound?'], nextStep: 'Try the empty state.' },
    });
    const r = (await explorations.continueExploration(ctx, { ref: 'shop#1', checkout: false })) as any;
    expect(r.notes).toMatchObject({ decisions: ['Toast stays 5 s'], nextStep: 'Try the empty state.', openQuestions: ['Sound?'], counts: { covered: 1, edgeCases: 1 } });
    expect(r.next).toContain('Read notes first');
    expect(r.next).toContain('1 decision, 1 of 1 edge cases covered, 1 open question');
    expect(r.next).toContain('notes.nextStep');
    const done = (await explorations.doneExploring(ctx, { ref: 'shop#1' })) as any;
    expect(done.forDevelopers.spec).toContain('- [x] Toast, Long text: wraps');
    expect(shop.pulls[0]!.body).toContain('**Design spec**');
    expect(shop.pulls[0]!.body).toContain('- Sound?');
    expect(shop.fileAt('explore/order-toast', '.bridge/explorations/order-toast.md')).toBeUndefined();
  });
});
