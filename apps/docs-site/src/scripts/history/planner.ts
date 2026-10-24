// The revert and restore planner: plans with @bridge-ds/core against main (live from GitHub when a token is
// connected, else the files this site was built from), shows conflicts with the later change that explains each,
// the designer diff and contrast impact from Reviews, the tier and the files. "Propose" opens a pull request on a
// new bridge/* branch with the user's token, like the token editor, or in suggest mode (bridge.config.json
// "changes") sends the files as one suggestion, no branch; main is never written. Without a token the
// plan downloads as a patch JSON and the PR text as Markdown.
import {
  LayeredTokenSet,
  fileModes,
  loadRepoFiles,
  modeLabel,
  planRestore,
  planRevert,
  type ChangePlan,
  type HistoryEntry,
  type HistoryReport,
  type RevertResolution,
  type TokenHistoryItem,
} from '@bridge-ds/core';
import { badgeHtml, isDialogOpen, openDialog, tokenValueHtml } from '@bridge-ds/react/dom';
import { reviewTokenChange, type TokenReview } from '../../lib/token-review';
import { undoSentence } from '../../lib/changes';
import { humanAuthored, laterThan, shortDate } from '../../lib/history-view';
import { esc, getToken, hasWorkingToken, prefersSignIn, readRepo, setButtonDisabled, setButtonLabel, showGhError, studioClient, tokenRejected } from '../github-session';
import { ghAction, ghVerb, notSentLine, SEE_SUGGESTION, sendButton, sendGoal, sendingLine, suggestionSentLine } from '../../lib/gh-wording';
import { changesModeOnPage } from '../changes-mode';
import { suggestFilesOnGitHub } from '../suggest-files';
import { loadHistory, type Loaded } from './state';
import { displayName } from '../people';
import { attrUrl } from '../../lib/html';
import { studioHref } from '../../lib/team-path';

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
const valueChip = (raw: unknown, css?: string) =>
  raw === undefined
    ? '<span class="cg-muted">none</span>'
    : tokenValueHtml(val(raw), { resolved: css && css !== raw ? css : undefined, swatch: css && /^#[0-9a-f]{6,8}$/i.test(css) ? css : false });

function statusLine(p: ChangePlan): string {
  if (p.status === 'ready') return `<p class="cg-muted">Bridge creates a branch for it and requests a review. Nothing reaches the library until a reviewer approves it.</p>`;
  if (p.status === 'blocked') return `<p class="rv-notice is-fail hp-state"><strong>Blocked:</strong> ${esc(p.why ?? 'the checks fail')}. Bridge never creates a branch that breaks validation or a contrast pair.</p>`;
  return `<p class="rv-notice hp-state"><strong>Nothing to propose.</strong> ${esc(p.why ?? '')}</p>`;
}

function paintError(message: string) {
  const body = $('hp-body');
  if (body) body.innerHTML = `<p class="rv-notice is-fail">${esc(message)}</p>`;
  syncFoot();
}

const shown = (v: { alias?: string | null; css?: string | null; hex?: string | null } | null, previous = false) =>
  v ? tokenValueHtml(v.alias ? `{${v.alias}}` : (v.css ?? ''), { swatch: v.hex ?? false, previous }) : '<span class="cg-muted">none</span>';

function changesList(review: TokenReview): string {
  if (!review.changes.length) return '';
  return `<ul class="hp-changes">${review.changes
    .map(
      (c) => `<li class="hp-change"><p class="hp-token"><span class="mono" title="${esc(c.path)}">${esc(c.path)}</span>${c.context ? `<span class="cg-muted">${esc(modeWord(c.context))}</span>` : ''}</p>
        <dl class="hp-ba"><dt>Now</dt><dd>${shown(c.before, true)}</dd><dt>After undo</dt><dd>${shown(c.after)}</dd></dl></li>`,
    )
    .join('')}</ul>`;
}

/** A contrast sample color: a hex, else nothing (the declaration is dropped). */
const hexOnly = (v: unknown) => (typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v) ? v : '');

export function pairsTable(review: TokenReview): string {
  const n = review.contrast.length;
  if (!n) return '';
  const rows = review.contrast
    .map(
      (p) => `<tr class="${p.after < p.min ? 'is-fail' : ''}"><th scope="row"><span class="hp-pair"><span class="rv-aa" style="background-color:${esc(hexOnly(p.bgHexAfter))};color:${esc(hexOnly(p.fgHexAfter))}" aria-hidden="true">Aa</span><span class="hp-pair-names"><span class="mono" title="${esc(p.fg)}">${esc(p.fg)}</span><span class="mono" title="${esc(p.bg)}"><span class="cg-muted">on</span> ${esc(p.bg)}</span></span></span></th>
        <td>${esc(p.where)}</td><td class="num">${p.before.toFixed(2)} -> <strong>${p.after.toFixed(2)}</strong>${p.after < p.min ? ` ${badgeHtml('Fails', { tone: 'danger', size: 'sm' })}` : ''}</td></tr>`,
    )
    .join('');
  return `<details class="cg-sec"><summary class="cg-sec-head"><span class="cg-sec-title">Contrast pairs</span><span class="cg-sec-meta">${n}</span><span class="cg-sec-chev" aria-hidden="true"></span></summary>
    <div class="cg-sec-body"><div class="table-wrap"><table class="rv-table hp-pairs"><thead><tr><th scope="col">Pair</th><th scope="col">Where</th><th scope="col">Ratio, min ${esc(String(review.contrast[0]!.min))}:1</th></tr></thead><tbody>${rows}</tbody></table></div></div></details>`;
}

const MODE_WORDS: Record<string, string> = { light: 'Light', dark: 'Dark' };
const modeWord = (m: string) => MODE_WORDS[m] ?? m.charAt(0).toUpperCase() + m.slice(1);

function paint() {
  const body = $('hp-body');
  if (!body || !plan || !req || !ctx || !base) return;
  const p = plan;
  const conflicts = p.conflicts.length
    ? `<section class="hp-sec"><h3 class="hp-sub">Conflicts <span class="tx-d-n">${p.conflicts.length}</span></h3>
        <p class="cg-muted">These tokens changed again after the original change. Bridge keeps their current value unless you choose otherwise.</p>
        <ul class="hp-conflicts">${p.conflicts
          .map((c, i) => {
            const canForce = c.reason === 'changed-later' || c.reason === 'removed-later' || c.reason === 'still-referenced';
            const later = c.later.length
              ? `<p>Changed again in ${c.later.map((l) => `${l.pr ? `#${esc(String(l.pr))} ` : ''}<strong>${esc(l.title)}</strong> (${esc(shortDate(l.date))}, ${esc(displayName(l.author))})`).join(', ')}.</p>`
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
  body.innerHTML = `<p class="hp-lead">${esc(lead)}</p>${statusLine(p)}${conflicts}${review ? changesList(review) : ''}${review ? pairsTable(review) : ''}${skipped}`;
  syncFoot();
}

function syncFoot() {
  const go = $<HTMLButtonElement>('hp-propose');
  const connect = $('hp-connect');
  const status = $('hp-status');
  const ready = plan?.status === 'ready';
  const token = hasWorkingToken();
  const mode = changesModeOnPage();
  if (go) {
    setButtonLabel(go, sendButton('revert', mode));
    go.hidden = !token && !req?.demo;
    setButtonDisabled(go, !ready || Boolean(req?.demo));
  }
  if (connect) {
    connect.hidden = token || Boolean(req?.demo);
    setButtonLabel(connect, ghAction(sendGoal('revert', mode), prefersSignIn(), tokenRejected()));
  }
  if (status) {
    status.textContent = req?.demo
      ? `Demo plans cannot ${mode === 'suggest' ? 'be sent' : 'go to review'}: the change never happened in this repository.`
      : !token
        ? tokenRejected()
          ? 'Your GitHub token stopped working.'
          : 'Read only until connected.'
        : base && !base.live
          ? `Could not read main from GitHub; this plan uses the files the site was built from. Bridge re-reads main when you ${mode === 'suggest' ? 'send it' : 'propose'}.`
          : '';
  }
}


/** What a send made: a pull request (direct mode) or a suggestion (suggest mode). */
type Sent = { kind: 'branch'; number: number } | { kind: 'suggestion'; number: number; url: string };

async function propose(): Promise<Sent> {
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
  if (changesModeOnPage() === 'suggest') {
    // One suggestion with the plan's files, planned on main's head: no branch, no pull request.
    const gh = studioClient(`${owner}/${name}`, token);
    const sha = await gh.getBranchSha(defaultBranch);
    if (!sha) throw new Error(`Branch ${defaultBranch} not found.`);
    const summary = p.commitMessage.split('\n').slice(1).join('\n').trim() || p.prTitle;
    const labels = ['tokens', p.kind, `tier: ${p.tier.tier}`, ...(p.tier.bump === 'major' ? ['breaking'] : [])];
    const r = await suggestFilesOnGitHub(gh, ctx.config, { kind: 'revert', title: p.prTitle, summary, files: p.files, tier: { tier: p.tier.tier, bump: p.tier.bump }, base: { ref: defaultBranch, sha }, checks: { newErrors: p.newErrors.length }, labels, details: p.prBody });
    return { kind: 'suggestion', number: r.number, url: r.url };
  }
  const gov = ctx.config.governance;
  const client = studioClient(`${owner}/${name}`, token, { protectedBranches: [...new Set([...gov.protectedBranches, 'main', 'master', defaultBranch])], branchPrefix: gov.branchPrefix });
  let branch = p.branch;
  for (let i = 2; await client.getBranchSha(branch); i++) branch = `${p.branch}-${i}`;
  await client.commitToNewBranch({ base: defaultBranch, branch, message: p.commitMessage, files: p.files });
  const pr = await client.createPullRequest({ title: p.prTitle, head: branch, base: defaultBranch, body: p.prBody, draft: p.tier.tier >= 2 });
  await client.addLabels(pr.number, ['tokens', 'source: bridge-web', `tier: ${p.tier.tier}`, p.kind, ...(p.tier.bump === 'major' ? ['breaking'] : [])]).catch(() => false);
  return { kind: 'branch', number: pr.number };
}

function wire() {
  if (wired) return;
  wired = true;
  $('hp-body')?.addEventListener('change', (e) => {
    const r = (e.target as HTMLElement).closest<HTMLInputElement>('input[type=radio][data-key]');
    if (!r) return;
    resolutions = { ...resolutions, [r.dataset.key!]: r.value as RevertResolution };
    compute();
  });
  $('hp-propose')?.addEventListener('click', async () => {
    const go = $<HTMLButtonElement>('hp-propose')!;
    const out = $('hp-status')!;
    setButtonDisabled(go, true);
    const mode = changesModeOnPage();
    out.textContent = `Reading main. ${sendingLine(mode)}`;
    try {
      const sent = await propose();
      if (sent.kind === 'branch') {
        location.href = studioHref(`changes/?pr=${sent.number}`);
        return;
      }
      // The suggestion is out: say so on the line of the action, keep the dialog's one primary off.
      go.hidden = true;
      out.innerHTML = `${esc(suggestionSentLine(sent.number))} <a href="${attrUrl(sent.url)}" target="_blank" rel="noopener">${esc(SEE_SUGGESTION)}</a>`;
    } catch (err) {
      showGhError(out, err, mode === 'suggest' ? notSentLine(mode, (err as Error).message) : `No branch created: ${(err as Error).message}`, mode === 'suggest' ? 'send suggestions' : 'create branches');
      setButtonDisabled(go, false);
    }
  });
}

async function open(r: Request) {
  wire();
  req = r;
  resolutions = {};
  plan = null;
  const title = $('hp-dialog-title');
  if (title) title.textContent = r.kind === 'revert' ? 'Undo this change' : 'Restore this value';
  const flag = $('hp-demo-flag');
  if (flag) flag.hidden = !r.demo;
  const body = $('hp-body');
  if (body) body.innerHTML = '<p class="muted">Reading main and planning</p>';
  if (!isDialogOpen('hp-dialog')) openDialog('hp-dialog');
  syncFoot();
  ctx = await loadHistory();
  base = await loadBase(ctx, r.demo);
  compute();
}

export const openRevertPlanner = (entry: HistoryEntry, report: HistoryReport, demo: boolean) => open({ kind: 'revert', entry, report, demo });
export const openRestorePlanner = (path: string, item: TokenHistoryItem, demo: boolean) => open({ kind: 'restore', path, item, demo });
