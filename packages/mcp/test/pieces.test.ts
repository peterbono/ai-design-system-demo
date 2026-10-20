// Product branches and the library over an in-memory GitHub: what a product branch adds outside the library, the
// library branch each piece opens (linked both ways), the preview the product branch takes, and the switch to the
// published version. The same operations back the MCP tools, the CLI and Studio (through @bridge-ds/core).
import { describe, expect, it } from 'vitest';
import { BridgeContext, pieces } from '../dist/lib.js';
import { parseNeededBy, parsePiecesRecord } from '@bridge-ds/core';
import { runPieces } from '../../cli/src/pieces.js';
import { fakeGitHub, readTree, REAL_PATHS, REPO } from './helpers.js';

const TSX = "import { Badge } from '@bridge-ds/react';\nimport styles from './billing.module.css';\nexport function Row() {\n  return <Badge className={styles.overdue}>Overdue</Badge>;\n}\n";
const CSS = '.overdue {\n  background: #fdecec;\n  color: #a3123a;\n}\n.total {\n  color: #c2410c;\n}\n';

function setup(owner = 'acme', name = 'ds') {
  const gh = fakeGitHub(owner, name, readTree(REPO, [...REAL_PATHS, 'packages/react/src/components/Badge']));
  const ro = () => BridgeContext.create({ repo: `${owner}/${name}`, fetch: gh.fetch });
  const rw = () => BridgeContext.create({ repo: `${owner}/${name}`, token: 't', fetch: gh.fetch });
  /** A product branch started from Create branch: explore/<slug>, a draft labeled exploration and product: admin. */
  const productBranch = (files: Record<string, string>, branch = 'explore/billing-overdue') => {
    const main = gh.refs.get('main')!;
    const next = new Map(gh.commits.get(main)!.files);
    for (const [p, t] of Object.entries(files)) next.set(p, t);
    const c = gh.id();
    gh.commits.set(c, { files: next, parents: [main] });
    gh.refs.set(branch, c);
    const number = gh.pulls.length + 1;
    const body = `## Exploration: Billing screen with overdue invoices\n\nPurpose.\n\n<!-- bridge-exploration ${JSON.stringify({ name: 'Billing screen with overdue invoices', purpose: 'Purpose.', slug: 'billing-overdue', author: 'ann' })} -->`;
    gh.pulls.push({ number, node_id: `PR_node_${number}`, title: 'Exploration: billing screen with overdue invoices', body, state: 'open', draft: true, user: { login: 'ann' }, head: { ref: branch, sha: c }, base: { ref: 'main' }, labels: [{ name: 'exploration' }, { name: 'product: admin' }], html_url: `https://github.com/${owner}/${name}/pull/${number}`, updated_at: '2026-10-20T00:00:00Z' });
    return number;
  };
  return { gh, ro, rw, productBranch };
}

const PRODUCT = { 'apps/admin/src/billing/Billing.tsx': TSX, 'apps/admin/src/billing/billing.module.css': CSS };

describe('missing pieces', () => {
  it('finds what the product branch adds outside the library, without a token, and records it with one', async () => {
    const { gh, ro, rw, productBranch } = setup();
    const n = productBranch(PRODUCT);
    const r = await pieces.missingPiecesOp(await ro(), { pr: n });
    expect(r).toMatchObject({ pr: n, product: 'Admin demo', files: 2, recorded: false });
    expect(r.pieces.map((p: any) => p.title)).toEqual(['Badge: overdue tone', 'New color #C2410C']);
    expect(r.pieces[0]).toMatchObject({ id: 'badge-overdue-tone', kind: 'variant', opens: 'a library exploration' });
    expect(r.pieces[1]).toMatchObject({ kind: 'token', opens: 'a token change' });
    expect(parsePiecesRecord(gh.pulls[n - 1]!.body)).toBeUndefined();

    await expect(pieces.missingPiecesOp(await ro(), { pr: n, record: true })).rejects.toThrow(/needs a GitHub token/);
    const saved = await pieces.missingPiecesOp(await rw(), { pr: n, record: true });
    expect(saved.recorded).toBe(true);
    const record = parsePiecesRecord(gh.pulls[n - 1]!.body)!;
    expect(record.pieces.map((p) => p.id)).toEqual(['badge-overdue-tone', saved.pieces[1]!.id]);
    expect(gh.pulls[n - 1]!.body).toMatch(/^## Exploration: Billing screen/);
    expect(gh.pulls[n - 1]!.body).toContain('### Missing from the library');
  });

  it('refuses a library branch', async () => {
    const { ro, productBranch, gh } = setup();
    const n = productBranch({ 'packages/react/src/x.css': '.a { color: #c2410c; }\n' }, 'explore/lib-only');
    gh.pulls[n - 1]!.labels = [{ name: 'exploration' }];
    await expect(pieces.missingPiecesOp(await ro(), { pr: n })).rejects.toThrow(/library branch \(Library\), not a product branch/);
  });
});

describe('a library branch per piece, linked both ways', () => {
  it('a variant opens a library exploration that says who needs it, and the product branch records the link', async () => {
    const { gh, rw, productBranch } = setup();
    const n = productBranch(PRODUCT);
    await pieces.missingPiecesOp(await rw(), { pr: n, record: true });
    const dry = await pieces.openLibraryBranchOp(await rw(), { pr: n, piece: 'badge-overdue-tone', dryRun: true });
    expect(dry).toMatchObject({ status: 'dry-run', opens: 'library exploration', title: 'Badge: overdue tone' });
    expect(gh.pulls).toHaveLength(1);

    const r = await pieces.openLibraryBranchOp(await rw(), { pr: n, piece: 'badge-overdue-tone' });
    expect(r).toMatchObject({ status: 'opened', opens: 'library exploration', neededBy: 'Billing screen with overdue invoices (#1) in Admin demo' });
    expect(r.library).toMatchObject({ kind: 'exploration', branch: 'explore/badge-overdue-tone' });
    expect(r.next).toMatch(/Build it on explore\/badge-overdue-tone: Add the overdue tone to Badge/);
    const lib = gh.pulls[r.library!.number - 1]!;
    expect(lib.labels.map((l: any) => l.name)).toEqual(expect.arrayContaining(['exploration', 'needed-by-product']));
    expect(lib.labels.map((l: any) => l.name)).not.toContain('product: admin');
    expect(parseNeededBy(lib.body)).toMatchObject({ pr: n, product: 'admin', author: 'ann', piece: 'badge-overdue-tone' });
    expect(lib.body.startsWith('**Needed by:** [Billing screen with overdue invoices]')).toBe(true);
    const record = parsePiecesRecord(gh.pulls[n - 1]!.body)!;
    expect(record.links).toEqual([expect.objectContaining({ piece: 'badge-overdue-tone', kind: 'exploration', number: r.library!.number, agent: 'claude', openedBy: 'owner' })]);

    // Opening it again does not open a second one; a new check keeps the link.
    expect((await pieces.openLibraryBranchOp(await rw(), { pr: n, piece: 'badge-overdue-tone' })).status).toBe('already-linked');
    await pieces.missingPiecesOp(await rw(), { pr: n, record: true });
    expect(parsePiecesRecord(gh.pulls[n - 1]!.body)!.links).toHaveLength(1);

    const view = await pieces.productBranchOp(await rw(), { pr: n });
    expect(view.said).toBe('Built with the library. 2 pieces were missing: 1 has a library branch, 1 still needs one.');
    expect(view.linked[0]).toMatchObject({ piece: 'Badge: overdue tone', status: 'Being built' });
    expect(view.linked[0]!.preview).toMatch(/has no change yet/);
    expect(view.notLinked.map((p: any) => p.kind)).toEqual(['token']);
  });

  it('a token piece opens a token change through the gate, and the product branch takes its preview, then switches once it ships', async () => {
    const { gh, rw, productBranch } = setup();
    const n = productBranch(PRODUCT);
    const found = await pieces.missingPiecesOp(await rw(), { pr: n, record: true });
    const id = found.pieces.find((p: any) => p.kind === 'token')!.id;
    const r = await pieces.openLibraryBranchOp(await rw(), { pr: n, piece: id });
    expect(r).toMatchObject({ status: 'opened', opens: 'token change' });
    const lib = gh.pulls[r.library!.number - 1]!;
    expect(lib.head.ref).toMatch(/^bridge\/add-color/);
    expect(lib.labels.map((l: any) => l.name)).toEqual(expect.arrayContaining(['source: mcp', 'tier: 3', 'tokens', 'needed-by-product']));
    expect(lib.draft).toBe(true);
    expect(parseNeededBy(lib.body)?.pr).toBe(n);
    expect(lib.body).toContain('## What changed and why');
    // The product branch now carries the library branch: its preview shows the real token.
    expect(r.preview).toMatchObject({ status: 'merged' });
    const productHead = gh.refs.get('explore/billing-overdue')!;
    const tokenFile = [...gh.commits.get(gh.refs.get(lib.head.ref)!)!.files.keys()].find((p) => p.endsWith('.tokens.json') && gh.fileAt(lib.head.ref, p) !== gh.fileAt('main', p))!;
    expect(gh.fileAt(productHead, tokenFile)).toBe(gh.fileAt(lib.head.ref, tokenFile));

    let view = await pieces.productBranchOp(await rw(), { pr: n });
    const linked = view.linked.find((l: any) => l.library.number === r.library!.number)!;
    expect(linked.status).toBe('Draft');
    expect(linked.preview).toMatch(/^Your branch uses a preview of the library branch/);
    expect(linked.action).toBeUndefined();
    expect(view.said).toMatch(/and Claude AI opened a library branch for it|1 has a library branch/);

    // The library branch gets a review fix: the preview is outdated until the product branch takes it again.
    const libHead = gh.refs.get(lib.head.ref)!;
    const fixed = new Map(gh.commits.get(libHead)!.files);
    fixed.set('.changeset/extra.md', '---\n---\nfix\n');
    const c = gh.id();
    gh.commits.set(c, { files: fixed, parents: [libHead] });
    gh.refs.set(lib.head.ref, c);
    view = await pieces.productBranchOp(await rw(), { pr: n });
    expect(view.linked.find((l: any) => l.library.number === r.library!.number)).toMatchObject({ action: 'Get the latest preview' });
    expect((await pieces.useLibraryPreviewOp(await rw(), { pr: n, piece: id })).status).toBe('merged');

    // It ships: the product branch switches to main.
    lib.draft = false;
    await gh.fetch(`https://api.github.com/repos/acme/ds/pulls/${r.library!.number}/merge`, { method: 'PUT', headers: { authorization: 'Bearer t' }, body: JSON.stringify({ merge_method: 'squash' }) });
    view = await pieces.productBranchOp(await rw(), { pr: n });
    const shipped = view.linked.find((l: any) => l.library.number === r.library!.number)!;
    expect(shipped).toMatchObject({ status: 'Shipped', action: 'Switch to the published version' });
    expect(shipped.tool).toBe(`bridge_switch_to_published { pr: ${n} }`);
    expect((await pieces.switchToPublishedOp(await rw(), { pr: n })).status).toBe('switched');
    view = await pieces.productBranchOp(await rw(), { pr: n });
    expect(view.linked.find((l: any) => l.library.number === r.library!.number)!.preview).toBe('Your branch uses the published version.');
  });

  it('a new component opens a request, and the CLI says the same', async () => {
    // The CLI runs in this repository: its config names the GitHub repository the fake stands for.
    const { gh, rw, productBranch } = setup('peterbono', 'ai-design-system-demo');
    const n = productBranch({ 'apps/admin/src/rating/Rating.tsx': "import { Rating } from '@mui/material';\nexport const R = () => <Rating value={3} />;\n" });
    await pieces.missingPiecesOp(await rw(), { pr: n, record: true });
    const lines: string[] = [];
    const io = { print: (s: string) => lines.push(s), error: (s: string) => lines.push(s), env: { GITHUB_TOKEN: 't' }, fetch: gh.fetch, ghToken: () => null, hasClaude: () => false, runClaude: async () => 0 } as any;
    expect(await runPieces({ _: ['pieces', String(n)], flags: {} }, REPO, io)).toBe(0);
    expect(lines.join('\n')).toMatch(/component-rating {2}New component: Rating: Rating comes from @mui\/material/);
    lines.length = 0;
    expect(await runPieces({ _: ['pieces', 'open', String(n), 'component-rating'], flags: {} }, REPO, io)).toBe(0);
    expect(lines[0]).toBe('Opened a component request: New component: Rating, needed by Billing screen with overdue invoices (#1) in Admin demo.');
    const issue = gh.issues[0]!;
    expect(issue.labels.map((l: any) => l.name)).toEqual(expect.arrayContaining(['component-change', 'request: new-component', 'source: cli', 'needed-by-product']));
    expect(parseNeededBy(issue.body)?.piece).toBe('component-rating');
    const record = parsePiecesRecord(gh.pulls[n - 1]!.body)!;
    expect(record.links[0]).toMatchObject({ kind: 'request', number: issue.number });
    expect(record.links[0]!.agent).toBeUndefined();
    lines.length = 0;
    expect(await runPieces({ _: ['pieces', 'status', String(n)], flags: {} }, REPO, io)).toBe(0);
    expect(lines.join('\n')).toMatch(/Built with the library\. 1 piece was missing, and you opened a library branch for it\./);
    expect(lines.join('\n')).toMatch(/Requested\. Nothing to preview yet/);
    await expect(pieces.useLibraryPreviewOp(await rw(), { pr: n, piece: 'component-rating' })).rejects.toThrow(/is a request: there is nothing to preview/);
  });
});
