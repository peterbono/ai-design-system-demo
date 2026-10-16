// The revert and restore planner: plans with @bridge-ds/core against main (live from GitHub when a token is
// connected, else the files this site was built from), shows conflicts with the later change that explains each,
// the designer diff and contrast impact from Reviews, the tier and the files. "Propose" opens a pull request on a
// new bridge/* branch with the user's token, like the token editor; main is never written. Without a token the
// plan downloads as a patch JSON and the PR text as Markdown.
import {
  GitHubClient,
  LayeredTokenSet,
  fileModes,
  loadRepoFiles,
  modeLabel,
  planRestore,
  planRevert,
  planToJson,
  type ChangePlan,
  type HistoryEntry,
  type HistoryReport,
  type RevertResolution,
  type TokenHistoryItem,
} from '@bridge-ds/core';
import { reviewTokenChange } from '../../lib/token-review';
import { humanAuthored, laterThan, shortDate } from '../../lib/history-view';
import { renderTokenReview } from '../reviews';
import { esc, getToken, readRepo } from '../github-session';
import { loadHistory, type Loaded } from './state';

type Request =
  | { kind: 'revert'; entry: HistoryEntry; report: HistoryReport; demo: boolean }
  | { kind: 'restore'; path: string; item: TokenHistoryItem; demo: boolean };

interface Base {
  files: Record<string, string>;
  label: string;
  live: boolean;
}

let req: Request | null = null;
let resolutions: Record<string, RevertResolution> = {};
let plan: ChangePlan | null = null;
let base: Base | null = null;
let ctx: Loaded | null = null;
let wired = false;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;

function repoOf(l: Loaded) {
  if (l.config.repo) return l.config.repo;
  const r = readRepo();
  return { owner: r.owner, name: r.repo, defaultBranch: r.defaultBranch };
}

async function loadBase(l: Loaded, demo: boolean): Promise<Base> {
  const built: Base = { files: l.data.files, label: `main as this site was built (${shortDate(l.data.generatedAt)})`, live: false };
  const token = getToken();
  // Demo plans run on the built files: they are fixtures, never proposed.
  if (demo || !token) return built;
  try {
    const { owner, name, defaultBranch } = repoOf(l);
    const client = new GitHubClient(`${owner}/${name}`, token);
    const sha = await client.getBranchSha(defaultBranch);
    if (!sha) return built;
    const latest = await loadRepoFiles(client, sha, l.config.tokens.root);
    return { files: latest.files, label: `${defaultBranch} on GitHub right now (${sha.slice(0, 7)})`, live: true };
  } catch {
    return built;
  }
}

function compute() {
  if (!req || !ctx || !base) return;
  const current = new LayeredTokenSet(ctx.config, new Map(Object.entries(base.files)));
  const common = { current, pairs: ctx.pairs, tool: 'the Bridge docs history', author: 'a person in the Bridge docs' };
  try {
    plan =
      req.kind === 'revert'
        ? planRevert({ ...common, entry: req.entry, later: laterThan(req.report.entries, req.entry), resolutions })
        : planRestore({ ...common, path: req.path, file: req.item.file, value: req.item.after, label: req.item.pr ? `#${req.item.pr.number}` : shortDate(req.item.date), item: req.item });
    plan = { ...plan, prBody: humanAuthored(plan.prBody) };
    paint();
  } catch (err) {
    plan = null;
    paintError((err as Error).message);
  }
}

function afterFiles(p: ChangePlan): Record<string, string> {
  const root = ctx!.config.tokens.root.replace(/\/$/, '');
  const out = { ...base!.files };
  for (const f of p.files) {
    const rel = root && root !== '.' && f.path.startsWith(`${root}/`) ? f.path.slice(root.length + 1) : null;
    if (rel !== null) out[rel] = f.content;
  }
  return out;
}

const val = (v: unknown) => (v === undefined ? 'none' : typeof v === 'string' ? v : JSON.stringify(v));
const swatchCss = (css?: string) => (css && /^#[0-9a-f]{6,8}$/i.test(css) ? `<span class="rv-sw" style="background-color:${esc(css)}"></span>` : '');
const valueChip = (raw: unknown, css?: string) => `<span class="rv-val">${swatchCss(css)}<span class="mono">${esc(val(raw))}</span>${css && css !== raw ? `<span class="muted mono small">${esc(css)}</span>` : ''}</span>`;

function statusBox(p: ChangePlan): string {
  if (p.status === 'ready') return `<p class="rv-notice is-pass hp-state"><strong>Ready to propose.</strong> Bridge opens a pull request on a new branch. Nothing reaches main until a reviewer merges it.</p>`;
  if (p.status === 'blocked') return `<p class="rv-notice is-fail hp-state"><strong>Blocked:</strong> ${esc(p.why ?? 'the checks fail')}. Bridge never opens a pull request that breaks validation or a contrast pair.</p>`;
  return `<p class="rv-notice hp-state"><strong>Nothing to propose.</strong> ${esc(p.why ?? '')}</p>`;
}

function paintError(message: string) {
  const body = $('hp-body');
  if (body) body.innerHTML = `<p class="rv-notice is-fail">${esc(message)}</p>`;
  syncFoot();
}

function paint() {
  const body = $('hp-body');
  if (!body || !plan || !req || !ctx || !base) return;
  const p = plan;
  const intro =
    req.kind === 'revert'
      ? `<p class="hp-lead">Undo <strong>${req.entry.pr ? `#${req.entry.pr.number} ` : ''}${esc(req.entry.title)}</strong>, merged ${esc(shortDate(req.entry.date))} by ${esc(req.entry.author)}. Bridge computes the opposite token edits against main as it is now, not a blind git revert.</p>`
      : `<p class="hp-lead">Put <span class="mono">${esc(req.path)}</span> in ${esc(modeLabel(req.item.modes))} back to ${valueChip(req.item.after, req.item.afterCss)}, the value it had after ${req.item.pr ? `#${req.item.pr.number} ` : ''}<strong>${esc(req.item.title)}</strong> (${esc(shortDate(req.item.date))}).</p>`;
  const conflicts = p.conflicts.length
    ? `<section class="hp-sec"><h3 class="rv-sub">Conflicts <span class="tx-d-n">${p.conflicts.length}</span></h3>
        <p class="small muted">These tokens changed again after the original change. Bridge keeps their current value unless you choose otherwise.</p>
        <ul class="hp-conflicts">${p.conflicts
          .map((c, i) => {
            const canForce = c.reason === 'changed-later' || c.reason === 'removed-later' || c.reason === 'still-referenced';
            const later = c.later.length
              ? `<p class="small">Changed again in ${c.later.map((l) => `${l.pr ? `#${l.pr} ` : ''}<strong>${esc(l.title)}</strong> (${esc(shortDate(l.date))}, ${esc(l.author)})`).join(', ')}.</p>`
              : '';
            return `<li class="hp-conflict">
              <p><span class="mono">${esc(c.path)}</span> <span class="pill is-warn">${esc(modeLabel(fileModes(ctx!.config, c.file)))}</span></p>
              <p class="small">${esc(c.message)}</p>${later}
              <dl class="hp-vals"><div><dt>Before the change</dt><dd>${valueChip(c.original.before, c.original.beforeCss)}</dd></div><div><dt>After the change</dt><dd>${valueChip(c.original.after, c.original.afterCss)}</dd></div>${c.current ? `<div><dt>Now on main</dt><dd>${valueChip(c.current.value, c.current.css)}</dd></div>` : ''}</dl>
              ${
                canForce
                  ? `<fieldset class="hp-choice"><legend class="sr-only">Decision for ${esc(c.path)}</legend>
                <label><input type="radio" name="hp-c-${i}" value="keep-current" data-key="${esc(c.key)}" ${c.resolution === 'keep-current' ? 'checked' : ''}/> Keep the current value</label>
                <label><input type="radio" name="hp-c-${i}" value="use-before" data-key="${esc(c.key)}" ${c.resolution === 'use-before' ? 'checked' : ''}/> Restore the old value</label></fieldset>`
                  : '<p class="small muted">Resolve this one by hand in the token editor.</p>'
              }
            </li>`;
          })
          .join('')}</ul></section>`
    : '';
  const planned = p.planned.length ? `<section class="hp-sec"><h3 class="rv-sub">Edits</h3><ul class="hp-list">${p.planned.map((x) => `<li>${esc(x.summary)}</li>`).join('')}</ul></section>` : '';
  const skipped = p.skipped.length ? `<section class="hp-sec"><h3 class="rv-sub">Left alone</h3><ul class="hp-list">${p.skipped.map((s) => `<li><span class="mono">${esc(s.path)}</span>: ${esc(s.reason)}</li>`).join('')}</ul></section>` : '';
  let diff = '';
  if (p.files.length) {
    const review = reviewTokenChange(base.files, afterFiles(p), ctx.pairs, ctx.layout);
    diff = `<section class="hp-sec"><h3 class="rv-sub">What changes on main</h3>${renderTokenReview(review)}</section>`;
  }
  const tier = p.status === 'nothing-to-do' ? '' : `<section class="hp-sec hp-meta"><p><span class="pill rv-tier is-t${p.tier.tier}">Tier ${p.tier.tier}</span> <span class="pill">${esc(p.tier.bump)}</span> <span class="small muted">${esc(p.tier.reasons.slice(0, 2).join('; '))}</span></p>
    <p class="small">Files: ${p.files.map((f) => `<code>${esc(f.path)}</code>`).join(', ')}</p>
    <p class="small">Branch: <code>${esc(p.branch)}</code>, ${p.tier.tier >= 2 ? 'opened as a draft pull request' : 'opened as a pull request'} on ${esc(repoOf(ctx).defaultBranch)}.</p>
    <details class="hp-pr"><summary>Pull request text</summary><pre>${esc(p.prBody)}</pre></details></section>`;
  body.innerHTML = `${intro}${statusBox(p)}<p class="small muted">Planned against ${esc(base.label)}.</p>${conflicts}${planned}${skipped}${diff}${tier}`;
  syncFoot();
}

function syncFoot() {
  const go = $<HTMLButtonElement>('hp-propose');
  const connect = $('hp-connect');
  const status = $('hp-status');
  const dl = [$<HTMLButtonElement>('hp-download-json'), $<HTMLButtonElement>('hp-download-md')];
  const ready = plan?.status === 'ready';
  const token = Boolean(getToken());
  for (const b of dl) if (b) b.disabled = !plan || !plan.files.length;
  if (go) {
    go.textContent = req?.kind === 'restore' ? 'Propose restore' : 'Propose revert';
    go.hidden = !token;
    go.disabled = !ready || Boolean(req?.demo);
  }
  if (connect) connect.hidden = token || Boolean(req?.demo);
  if (status) {
    status.textContent = req?.demo
      ? 'Demo plans cannot be proposed: the change they undo never happened in this repository. Downloads are labelled demo.'
      : !token
        ? 'Read only: connect GitHub to open this as a pull request, or download the patch and the PR text.'
        : base && !base.live
          ? 'Could not read main from GitHub; this plan uses the files the site was built from. Bridge re-reads main when you propose.'
          : '';
  }
}

function download(name: string, text: string, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const fileStem = () => `bridge-${req?.demo ? 'demo-' : ''}${plan?.kind ?? 'plan'}-${(plan?.branch ?? 'plan').split('/').pop()}`;

async function propose(): Promise<number> {
  if (!req || !ctx || req.demo) throw new Error('Demo plans cannot be proposed.');
  const token = getToken();
  if (!token) throw new Error('Connect GitHub first.');
  // Re-plan against main as it is right now, with the same conflict decisions.
  base = await loadBase(ctx, false);
  if (!base.live) throw new Error('Bridge could not read main from GitHub. Check the token, then try again.');
  compute();
  const p = plan;
  if (!p || p.status !== 'ready') throw new Error(p?.why ?? 'The plan is not ready on the latest main.');
  const { owner, name, defaultBranch } = repoOf(ctx);
  const gov = ctx.config.governance;
  const client = new GitHubClient(`${owner}/${name}`, token, undefined, undefined, { protectedBranches: [...new Set([...gov.protectedBranches, 'main', 'master', defaultBranch])], branchPrefix: gov.branchPrefix });
  let branch = p.branch;
  for (let i = 2; await client.getBranchSha(branch); i++) branch = `${p.branch}-${i}`;
  await client.commitToNewBranch({ base: defaultBranch, branch, message: p.commitMessage, files: p.files });
  const pr = await client.createPullRequest({ title: p.prTitle, head: branch, base: defaultBranch, body: p.prBody, draft: p.tier.tier >= 2 });
  await client.addLabels(pr.number, ['tokens', 'source: bridge-web', `tier-${p.tier.tier}`, p.kind, ...(p.tier.bump === 'major' ? ['breaking'] : [])]).catch(() => false);
  return pr.number;
}

function wire() {
  if (wired) return;
  wired = true;
  const dialog = $<HTMLDialogElement>('hp-dialog');
  $('hp-close')?.addEventListener('click', () => dialog?.close());
  dialog?.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
  $('hp-body')?.addEventListener('change', (e) => {
    const r = (e.target as HTMLElement).closest<HTMLInputElement>('input[type=radio][data-key]');
    if (!r) return;
    resolutions = { ...resolutions, [r.dataset.key!]: r.value as RevertResolution };
    compute();
  });
  $('hp-download-json')?.addEventListener('click', () => {
    if (!plan) return;
    const json = { ...planToJson(plan), ...(req?.demo ? { demo: true, $comment: 'Demo data: fixture change, not this repository history. Do not apply.' } : {}) };
    download(`${fileStem()}.json`, `${JSON.stringify(json, null, 2)}\n`, 'application/json');
  });
  $('hp-download-md')?.addEventListener('click', () => {
    if (!plan) return;
    const head = req?.demo ? '> Demo data: fixture change, not this repository history.\n\n' : '';
    download(`${fileStem()}.md`, `${head}# ${plan.prTitle}\n\n${plan.prBody}`, 'text/markdown');
  });
  $('hp-propose')?.addEventListener('click', async () => {
    const go = $<HTMLButtonElement>('hp-propose')!;
    const out = $('hp-status')!;
    go.disabled = true;
    out.textContent = 'Reading main, creating a bridge/ branch with the token files and a changeset, opening the pull request';
    try {
      const n = await propose();
      location.href = `/reviews/?pr=${n}`;
    } catch (err) {
      out.textContent = `Not proposed: ${(err as Error).message}`;
      go.disabled = false;
    }
  });
}

async function open(r: Request) {
  wire();
  req = r;
  resolutions = {};
  plan = null;
  const dialog = $<HTMLDialogElement>('hp-dialog');
  const title = $('hp-title');
  if (title) title.textContent = r.kind === 'revert' ? 'Undo this change' : 'Restore this value';
  const flag = $('hp-demo-flag');
  if (flag) flag.hidden = !r.demo;
  const body = $('hp-body');
  if (body) body.innerHTML = '<p class="muted">Reading main and planning</p>';
  if (dialog && !dialog.open) dialog.showModal();
  syncFoot();
  ctx = await loadHistory();
  base = await loadBase(ctx, r.demo);
  compute();
}

export const openRevertPlanner = (entry: HistoryEntry, report: HistoryReport, demo: boolean) => open({ kind: 'revert', entry, report, demo });
export const openRestorePlanner = (path: string, item: TokenHistoryItem, demo: boolean) => open({ kind: 'restore', path, item, demo });
