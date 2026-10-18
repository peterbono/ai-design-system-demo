// The revert and restore planner: plans with @bridge-ds/core against main (live from GitHub when a token is
// connected, else the files this site was built from), shows conflicts with the later change that explains each,
// the designer diff and contrast impact from Reviews, the tier and the files. "Propose" opens a pull request on a
// new bridge/* branch with the user's token, like the token editor; main is never written. Without a token the
// plan downloads as a patch JSON and the PR text as Markdown.
import {
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
import { reviewTokenChange, type TokenReview } from '../../lib/token-review';
import { undoSentence } from '../../lib/changes';
import { humanAuthored, laterThan, shortDate } from '../../lib/history-view';
import { esc, getToken, hasWorkingToken, prefersSignIn, readRepo, setButtonDisabled, setButtonLabel, showGhError, studioClient, tokenRejected } from '../github-session';
import { ghAction, ghVerb } from '../../lib/gh-wording';
import { mdTitleHtml } from '../../lib/markdown';
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
    const client = studioClient(`${owner}/${name}`, token);
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

function statusLine(p: ChangePlan): string {
  if (p.status === 'ready') return `<p class="cg-muted">Bridge opens a pull request on a new branch. Nothing reaches main until a reviewer merges it.</p>`;
  if (p.status === 'blocked') return `<p class="rv-notice is-fail hp-state"><strong>Blocked:</strong> ${esc(p.why ?? 'the checks fail')}. Bridge never opens a pull request that breaks validation or a contrast pair.</p>`;
  return `<p class="rv-notice hp-state"><strong>Nothing to propose.</strong> ${esc(p.why ?? '')}</p>`;
}

function paintError(message: string) {
  const body = $('hp-body');
  if (body) body.innerHTML = `<p class="rv-notice is-fail">${esc(message)}</p>`;
  syncFoot();
}

const swatchHex = (hex?: string | null) => (hex ? `<span class="rv-sw" style="background-color:${esc(hex)}" aria-hidden="true"></span>` : '');
const shown = (v: { alias?: string | null; css?: string | null; hex?: string | null } | null) =>
  v ? `<span class="hp-v">${swatchHex(v.hex)}<span class="mono" title="${esc(v.alias ? `{${v.alias}}` : (v.css ?? ''))}">${esc(v.alias ? `{${v.alias}}` : (v.css ?? ''))}</span></span>` : '<span class="cg-muted">none</span>';

function changesList(review: TokenReview): string {
  if (!review.changes.length) return '';
  return `<ul class="hp-changes">${review.changes
    .map(
      (c) => `<li class="hp-change"><p class="hp-token"><span class="mono" title="${esc(c.path)}">${esc(c.path)}</span>${c.context ? `<span class="cg-muted">${esc(modeWord(c.context))}</span>` : ''}</p>
        <dl class="hp-ba"><dt>Now</dt><dd>${shown(c.before)}</dd><dt>After undo</dt><dd>${shown(c.after)}</dd></dl></li>`,
    )
    .join('')}</ul>`;
}

function pairsTable(review: TokenReview): string {
  const n = review.contrast.length;
  if (!n) return '';
  const rows = review.contrast
    .map(
      (p) => `<tr class="${p.after < p.min ? 'is-fail' : ''}"><th scope="row"><span class="hp-pair"><span class="rv-aa" style="background-color:${esc(p.bgHexAfter)};color:${esc(p.fgHexAfter)}" aria-hidden="true">Aa</span><span class="hp-pair-names"><span class="mono" title="${esc(p.fg)}">${esc(p.fg)}</span><span class="mono" title="${esc(p.bg)}"><span class="cg-muted">on</span> ${esc(p.bg)}</span></span></span></th>
        <td>${esc(p.where)}</td><td class="num">${p.before.toFixed(2)} -> <strong>${p.after.toFixed(2)}</strong>${p.after < p.min ? ' <span class="pill is-fail">Fails</span>' : ''}</td></tr>`,
    )
    .join('');
  return `<details class="cg-sec"><summary class="cg-sec-head"><span class="cg-sec-title">Contrast pairs</span><span class="cg-sec-meta">${n}</span><span class="cg-sec-chev" aria-hidden="true"></span></summary>
    <div class="cg-sec-body"><div class="table-wrap"><table class="rv-table hp-pairs"><thead><tr><th scope="col">Pair</th><th scope="col">Where</th><th scope="col">Ratio, min ${review.contrast[0]!.min}:1</th></tr></thead><tbody>${rows}</tbody></table></div></div></details>`;
}

const MODE_WORDS: Record<string, string> = { light: 'Light', dark: 'Dark' };
const modeWord = (m: string) => MODE_WORDS[m] ?? m.charAt(0).toUpperCase() + m.slice(1);

function paint() {
  const body = $('hp-body');
  if (!body || !plan || !req || !ctx || !base) return;
  const p = plan;
  const source =
    req.kind === 'revert'
      ? `Undoes ${req.entry.pr ? `#${req.entry.pr.number} ` : ''}<strong>${mdTitleHtml(req.entry.title)}</strong>, merged ${esc(shortDate(req.entry.date))} by ${esc(req.entry.author)}. Bridge computes the opposite token edits against main as it is now, not a blind git revert.`
      : `Puts <span class="mono">${esc(req.path)}</span> in ${esc(modeLabel(req.item.modes))} back to ${valueChip(req.item.after, req.item.afterCss)}, the value it had after ${req.item.pr ? `#${req.item.pr.number} ` : ''}<strong>${esc(req.item.title)}</strong> (${esc(shortDate(req.item.date))}).`;
  const conflicts = p.conflicts.length
    ? `<section class="hp-sec"><h3 class="hp-sub">Conflicts <span class="tx-d-n">${p.conflicts.length}</span></h3>
        <p class="cg-muted">These tokens changed again after the original change. Bridge keeps their current value unless you choose otherwise.</p>
        <ul class="hp-conflicts">${p.conflicts
          .map((c, i) => {
            const canForce = c.reason === 'changed-later' || c.reason === 'removed-later' || c.reason === 'still-referenced';
            const later = c.later.length
              ? `<p>Changed again in ${c.later.map((l) => `${l.pr ? `#${l.pr} ` : ''}<strong>${esc(l.title)}</strong> (${esc(shortDate(l.date))}, ${esc(l.author)})`).join(', ')}.</p>`
              : '';
            return `<li class="hp-conflict">
              <p><span class="mono">${esc(c.path)}</span> <span class="cg-muted">${esc(modeLabel(fileModes(ctx!.config, c.file)))}</span></p>
              <p>${esc(c.message)}</p>${later}
              <dl class="hp-vals"><div><dt>Before the change</dt><dd>${valueChip(c.original.before, c.original.beforeCss)}</dd></div><div><dt>After the change</dt><dd>${valueChip(c.original.after, c.original.afterCss)}</dd></div>${c.current ? `<div><dt>Now on main</dt><dd>${valueChip(c.current.value, c.current.css)}</dd></div>` : ''}</dl>
              ${
                canForce
                  ? `<fieldset class="hp-choice"><legend class="sr-only">Decision for ${esc(c.path)}</legend>
                <label><input type="radio" name="hp-c-${i}" value="keep-current" data-key="${esc(c.key)}" ${c.resolution === 'keep-current' ? 'checked' : ''}/> Keep the current value</label>
                <label><input type="radio" name="hp-c-${i}" value="use-before" data-key="${esc(c.key)}" ${c.resolution === 'use-before' ? 'checked' : ''}/> Restore the old value</label></fieldset>`
                  : '<p class="cg-muted">Resolve this one by hand in the token editor.</p>'
              }
            </li>`;
          })
          .join('')}</ul></section>`
    : '';
  const skipped = p.skipped.length ? `<section class="hp-sec"><h3 class="hp-sub">Left alone</h3><ul class="hp-list">${p.skipped.map((x) => `<li><span class="mono">${esc(x.path)}</span>: ${esc(x.reason)}</li>`).join('')}</ul></section>` : '';
  const review = p.files.length ? reviewTokenChange(base.files, afterFiles(p), ctx.pairs, ctx.layout) : null;
  const lead = review ? undoSentence(review) : p.status === 'nothing-to-do' ? 'Nothing to undo: main already has these values.' : p.planned.map((x) => x.summary).join('. ');
  const details =
    p.status === 'nothing-to-do'
      ? ''
      : `<details class="cg-sec"><summary class="cg-sec-head"><span class="cg-sec-title">Details</span><span class="cg-sec-meta">Tier ${p.tier.tier}, ${esc(p.tier.bump)}</span><span class="cg-sec-chev" aria-hidden="true"></span></summary><div class="cg-sec-body hp-meta">
    <p>${source}</p>
    <p class="cg-muted">Planned against ${esc(base.label)}. ${esc(p.tier.reasons.slice(0, 2).join('; '))}</p>
    <p>Files: ${p.files.map((f) => `<code>${esc(f.path)}</code>`).join(', ')}</p>
    <p>Branch: <code>${esc(p.branch)}</code>, ${p.tier.tier >= 2 ? 'opened as a draft pull request' : 'opened as a pull request'} on ${esc(repoOf(ctx).defaultBranch)}.</p>
    <details class="hp-pr"><summary>Pull request text</summary><pre>${esc(p.prBody)}</pre></details>
    <p class="hp-dl"><button type="button" class="btn btn-secondary btn-sm" id="hp-download-json">Download patch</button> <button type="button" class="btn btn-secondary btn-sm" id="hp-download-md">Download PR text</button></p></div></details>`;
  body.innerHTML = `<p class="hp-lead">${esc(lead)}</p>${statusLine(p)}${conflicts}${review ? changesList(review) : ''}${review ? pairsTable(review) : ''}${skipped}${details}`;
  syncFoot();
}

function syncFoot() {
  const go = $<HTMLButtonElement>('hp-propose');
  const connect = $('hp-connect');
  const status = $('hp-status');
  const dl = [$<HTMLButtonElement>('hp-download-json'), $<HTMLButtonElement>('hp-download-md')];
  const ready = plan?.status === 'ready';
  const token = hasWorkingToken();
  for (const b of dl) if (b) setButtonDisabled(b, !plan || !plan.files.length);
  if (go) {
    setButtonLabel(go, req?.kind === 'restore' ? 'Propose restore' : 'Propose undo');
    go.hidden = !token && !req?.demo;
    setButtonDisabled(go, !ready || Boolean(req?.demo));
  }
  if (connect) {
    connect.hidden = token || Boolean(req?.demo);
    setButtonLabel(connect, ghAction('propose', prefersSignIn(), tokenRejected()));
  }
  if (status) {
    status.textContent = req?.demo
      ? 'Demo plans cannot be proposed: the change never happened in this repository.'
      : !token
        ? tokenRejected()
          ? 'Your GitHub token stopped working. Details has the patch and the PR text.'
          : 'Read only until connected. Details has the patch and the PR text.'
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
  if (!token) throw new Error(`${ghVerb(prefersSignIn())} first.`);
  // Re-plan against main as it is right now, with the same conflict decisions.
  base = await loadBase(ctx, false);
  if (!base.live) throw new Error('Bridge could not read main from GitHub. Check the token, then try again.');
  compute();
  const p = plan;
  if (!p || p.status !== 'ready') throw new Error(p?.why ?? 'The plan is not ready on the latest main.');
  const { owner, name, defaultBranch } = repoOf(ctx);
  const gov = ctx.config.governance;
  const client = studioClient(`${owner}/${name}`, token, { protectedBranches: [...new Set([...gov.protectedBranches, 'main', 'master', defaultBranch])], branchPrefix: gov.branchPrefix });
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
  $('hp-body')?.addEventListener('click', (e) => {
    const id = (e.target as HTMLElement).closest('button')?.id;
    if (id === 'hp-download-json') downloadJson();
    if (id === 'hp-download-md') downloadMd();
  });
  const downloadJson = () => {
    if (!plan) return;
    const json = { ...planToJson(plan), ...(req?.demo ? { demo: true, $comment: 'Demo data: fixture change, not this repository history. Do not apply.' } : {}) };
    download(`${fileStem()}.json`, `${JSON.stringify(json, null, 2)}\n`, 'application/json');
  };
  const downloadMd = () => {
    if (!plan) return;
    const head = req?.demo ? '> Demo data: fixture change, not this repository history.\n\n' : '';
    download(`${fileStem()}.md`, `${head}# ${plan.prTitle}\n\n${plan.prBody}`, 'text/markdown');
  };
  $('hp-propose')?.addEventListener('click', async () => {
    const go = $<HTMLButtonElement>('hp-propose')!;
    const out = $('hp-status')!;
    setButtonDisabled(go, true);
    out.textContent = 'Reading main, creating a bridge/ branch with the token files and a changeset, opening the pull request';
    try {
      const n = await propose();
      location.href = `/studio/changes/?pr=${n}`;
    } catch (err) {
      showGhError(out, err, `Not proposed: ${(err as Error).message}`, 'open pull requests');
      setButtonDisabled(go, false);
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
