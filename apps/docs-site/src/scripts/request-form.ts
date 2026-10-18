// "Change this component" in the Studio Components drawer. The designer drives the change, Claude builds it, a
// developer checks the code. The drawer first asks what she wants to change (components/ds/studio/ChangeIntent, a DS
// RadioGroup in place), then shows the flow under the choice:
// - Adjust the look: a link to the Studio token editor filtered to this component's tokens (the "Edit tokens" door).
// - Add a variant or option: one form (what to add, what it is for, the Figma frame link and an image) that sends the
//   request (kind new-variant) and starts an exploration linked to it, the same core calls as "Start an exploration"
//   from a request (scripts/exploration-start.ts). "Ask a developer instead" sends the same form as a plain request.
// - Something looks wrong: the same form as "Report a mismatch" (kind bug), with the what, now and in Figma rows.
// Requests are GitHub issues labeled component-change, written with the viewer's own token (composeRequestIssue from
// @bridge-ds/core, source "studio"), with the labels and assignees of bridge.config.json integrations.requests; the
// image is committed to the requests branch first, like the Figma plugin does. Signed out, the choice still shows and
// the final action opens the GitHub connect dialog. Words and rules: lib/change-intent.ts.
import { REQUESTS_BRANCH, composeRequestIssue, ensureRequestsBranch, requestImagePath, type GitHubClient } from '@bridge-ds/core';
import { explorationFromRequest } from '../lib/requests-view';
import { changeFormCopy, changeFormProblems, changeRequest, formModeFor, sentLine, startedLines, type ChangeFormMode, type ChangeIntent } from '../lib/change-intent';
import { ghAction } from '../lib/gh-wording';
import { base64Of, figmaFromLink, figmaLinkProblem, imageProblem, MAX_IMAGE_BYTES, requestImageUrl } from '../lib/request-attachments';
import { INTENT_EVENT, INTENT_SET_EVENT, type IntentSetDetail } from '../components/ds/studio/ChangeIntent';
import { currentViewer, esc, getToken, hasWorkingToken, initGitHubConnect, prefersSignIn, readRepo, setButtonBusy, setButtonLabel, showGhError, studioClient } from './github-session';
import { explorationsConfig, startLinkedExploration } from './exploration-start';
import { forgetRequests, integrations } from './requests';

const q = <T extends HTMLElement>(root: ParentNode, sel: string) => root.querySelector<T>(sel);

interface FormValues {
  title: string;
  summary: string;
  changes: { field: string; before: string; after: string }[];
}

function readForm(form: HTMLFormElement): FormValues {
  const v = (name: string) => ((form.elements.namedItem(name) as HTMLInputElement | null)?.value ?? '').toString();
  return {
    title: v('title'),
    summary: v('summary'),
    changes: [...form.querySelectorAll<HTMLElement>('[data-rq-change]')].map((row) => ({
      field: q<HTMLInputElement>(row, '[name="field"]')?.value ?? '',
      before: q<HTMLInputElement>(row, '[name="before"]')?.value ?? '',
      after: q<HTMLInputElement>(row, '[name="after"]')?.value ?? '',
    })),
  };
}

// The attached image of each form, as a PNG data URL (any picked or pasted image is redrawn as PNG: the requests
// branch stores .png files).
const images = new WeakMap<HTMLFormElement, string>();

function clearImage(form: HTMLFormElement) {
  images.delete(form);
  const box = q<HTMLElement>(form, '[data-rq-image-preview]');
  const img = q<HTMLImageElement>(form, '[data-rq-image-img]');
  const pick = q<HTMLElement>(form, '[data-rq-image-pick]');
  const file = q<HTMLInputElement>(form, '[data-rq-image-file]');
  if (box) box.hidden = true;
  if (img) img.removeAttribute('src');
  if (pick) pick.hidden = false;
  if (file) file.value = '';
}

async function toPng(file: Blob): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas.toDataURL('image/png');
}

/** Attaches one image to the form, or says why it cannot. */
async function setImage(form: HTMLFormElement, file: File, error: HTMLElement) {
  const problem = imageProblem(file);
  const fail = (text: string) => {
    error.textContent = text;
    error.hidden = false;
  };
  if (problem) return fail(problem);
  try {
    const url = await toPng(file);
    if (((base64Of(url)?.length ?? 0) * 3) / 4 > MAX_IMAGE_BYTES) return fail('This image is larger than 5 MB as a PNG. Export the frame at 1x or crop it, then attach it again.');
    images.set(form, url);
    const img = q<HTMLImageElement>(form, '[data-rq-image-img]');
    if (img) img.src = url;
    q<HTMLElement>(form, '[data-rq-image-preview]')!.hidden = false;
    q<HTMLElement>(form, '[data-rq-image-pick]')!.hidden = true;
    error.hidden = true;
  } catch {
    fail('This image could not be read. Export it again as PNG or JPEG, then attach it.');
  }
}

const connected = () => Boolean(hasWorkingToken() && currentViewer());

/** Sets a DS Field label's text, keeping its required mark. */
function setLabel(control: HTMLInputElement | HTMLTextAreaElement | null, text: string) {
  const label = control?.labels?.[0];
  const node = label && [...label.childNodes].find((n) => n.nodeType === Node.TEXT_NODE);
  if (node) node.nodeValue = text;
}

/** The form in one mode: its heading, labels, placeholders, rows and buttons. */
function paintMode(drawer: HTMLElement, form: HTMLFormElement, mode: ChangeFormMode) {
  const copy = changeFormCopy(mode, drawer.dataset.component ?? 'component', prefersSignIn());
  form.dataset.mode = mode;
  const heading = q<HTMLElement>(form, '[data-cm-form-title]');
  if (heading) heading.textContent = copy.heading;
  const title = form.elements.namedItem('title') as HTMLInputElement | null;
  const summary = form.elements.namedItem('summary') as HTMLTextAreaElement | null;
  setLabel(title, copy.title.label);
  setLabel(summary, copy.summary.label);
  title?.setAttribute('placeholder', copy.title.placeholder);
  summary?.setAttribute('placeholder', copy.summary.placeholder);
  const rows = q<HTMLElement>(form, '[data-rq-changes]');
  if (rows) rows.hidden = !copy.changes;
  const swap = q<HTMLElement>(form, '[data-cm-ask]');
  if (swap) {
    swap.hidden = !copy.swap;
    if (copy.swap) {
      swap.dataset.to = copy.swap.to;
      setButtonLabel(swap, copy.swap.label);
    }
  }
  // A new mode starts without the marks of the last one: what she typed stays.
  form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
  const err = q<HTMLElement>(form, '[data-rq-error]');
  if (err) err.hidden = true;
  const submit = q<HTMLButtonElement>(form, '[data-rq-submit]');
  if (submit) setButtonLabel(submit, copy.submit);
  const connect = q<HTMLElement>(form, '[data-cm-connect]');
  if (connect) setButtonLabel(connect, copy.connect);
}

function paintAuth(drawer: HTMLElement) {
  const on = connected();
  drawer.querySelectorAll<HTMLElement>('[data-cm-chg] [data-gh-only]').forEach((el) => (el.hidden = !on));
  drawer.querySelectorAll<HTMLElement>('[data-cm-chg] [data-no-gh]').forEach((el) => (el.hidden = on));
}

function emptyForm(form: HTMLFormElement) {
  form.reset();
  form.querySelectorAll('[data-rq-change]').forEach((row, i) => i > 0 && row.remove());
  form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
  const err = q<HTMLElement>(form, '[data-rq-error]');
  if (err) err.hidden = true;
  clearImage(form);
}

/** Shows the step that follows the choice: the token link, the form in its mode, or nothing yet. */
function showIntent(drawer: HTMLElement, intent: ChangeIntent | null) {
  const box = q<HTMLElement>(drawer, '[data-cm-chg]');
  const form = q<HTMLFormElement>(drawer, '[data-cm-req-form]');
  const look = q<HTMLAnchorElement>(drawer, '[data-cm-look]');
  const foot = q<HTMLElement>(drawer, '[data-cm-chg-foot]');
  if (!box || !form) return;
  if (intent) drawer.dataset.intent = intent;
  else delete drawer.dataset.intent;
  const mode = intent ? formModeFor(intent) : null;
  const err = q<HTMLElement>(form, '[data-rq-error]');
  if (err) err.hidden = true;
  form.hidden = !mode;
  if (foot) foot.hidden = Boolean(mode);
  if (look) {
    look.hidden = intent !== 'look';
    look.href = drawer.dataset.tokensHref || '/studio/tokens/';
    setButtonLabel(look, `Edit ${drawer.dataset.component ?? 'its'} tokens`);
  }
  if (mode) paintMode(drawer, form, mode);
  paintAuth(drawer);
}

/** Back to the component: the change step closed and emptied, the actions row back. */
export function resetChangeFlow(drawer: HTMLElement, focusOpener = false) {
  const box = q<HTMLElement>(drawer, '[data-cm-chg]');
  const form = q<HTMLFormElement>(drawer, '[data-cm-req-form]');
  if (!box || !form) return;
  const wasOpen = drawer.dataset.mode === 'change';
  delete drawer.dataset.mode;
  box.hidden = true;
  emptyForm(form);
  showIntent(drawer, null);
  const detail: IntentSetDetail = { value: null, hasTokens: drawer.dataset.hasTokens === 'true' };
  document.dispatchEvent(new CustomEvent(INTENT_SET_EVENT, { detail }));
  const opener = drawer.querySelector<HTMLButtonElement>('[data-cm-panel]:not([hidden]) [data-cm-change-open]');
  opener?.setAttribute('aria-expanded', 'false');
  if (focusOpener && wasOpen) opener?.focus();
}

/**
 * Picks an intent from outside the drawer (the Overview "Start a change" deep link): the radio shows it as picked and
 * the step that follows opens. "Adjust the look" stays unpicked on a component with no token.
 */
export function pickChangeIntent(drawer: HTMLElement, intent: ChangeIntent) {
  if (drawer.dataset.mode !== 'change') return;
  if (intent === 'look' && drawer.dataset.hasTokens !== 'true') return;
  showIntent(drawer, intent);
  const detail: IntentSetDetail = { value: intent, hasTokens: drawer.dataset.hasTokens === 'true' };
  document.dispatchEvent(new CustomEvent(INTENT_SET_EVENT, { detail }));
}

/** Hides what the last change said (a new component, or a new change). */
export function clearChangeDone(drawer: HTMLElement) {
  const done = q<HTMLElement>(drawer, '[data-rq-done]');
  if (done) done.hidden = true;
}

function openChange(drawer: HTMLElement, opener: HTMLButtonElement) {
  const box = q<HTMLElement>(drawer, '[data-cm-chg]');
  if (!box) return;
  clearChangeDone(drawer);
  drawer.dataset.mode = 'change';
  box.hidden = false;
  opener.setAttribute('aria-expanded', 'true');
  showIntent(drawer, null);
  const detail: IntentSetDetail = { value: null, hasTokens: drawer.dataset.hasTokens === 'true' };
  document.dispatchEvent(new CustomEvent(INTENT_SET_EVENT, { detail }));
  // The first choice that can be picked takes the focus: the step reads from the question down.
  requestAnimationFrame(() => box.querySelector<HTMLElement>('[role="radio"]:not([aria-disabled="true"]):not([data-disabled])')?.focus());
}

/** Sends the request the form describes (the image first, on the requests branch). Returns the issue. */
async function sendRequest(gh: GitHubClient, drawer: HTMLElement, form: HTMLFormElement, mode: ChangeFormMode, values: FormValues, figmaRaw: string) {
  const component = drawer.dataset.component ?? 'Component';
  const slug = drawer.dataset.slug ?? '';
  const repo = readRepo();
  const cfg = integrations().requests ?? {};
  const attached = images.get(form);
  const urls: string[] = [];
  const base64 = attached ? base64Of(attached) : null;
  if (base64) {
    await ensureRequestsBranch(gh, repo.defaultBranch);
    const path = requestImagePath(component, new Date());
    await gh.putBase64File({ path, base64, branch: REQUESTS_BRANCH, message: `Image for the ${component} request from Studio` });
    urls.push(requestImageUrl(repo.owner, repo.repo, path));
  }
  const figma = figmaFromLink(figmaRaw);
  const request = { ...changeRequest(component, mode, values, currentViewer()?.login), ...(figma ? { figma } : {}), ...(urls.length ? { images: urls } : {}) };
  const issue = composeRequestIssue(request, {
    labels: cfg.labels ?? [],
    // She builds it herself with Claude: the starter is put on it when the exploration links, not the default assignees.
    assignees: mode === 'explore' ? [] : (cfg.assignees ?? []),
    ...(slug ? { componentUrl: `${location.origin}/components/${slug}/` } : {}),
  });
  const created = await gh.createIssue(issue);
  forgetRequests();
  return { created, request };
}

export function initChangeFlow(drawer: HTMLElement) {
  const box = q<HTMLElement>(drawer, '[data-cm-chg]');
  const form = q<HTMLFormElement>(drawer, '[data-cm-req-form]');
  if (!box || !form) return;
  const error = q<HTMLElement>(form, '[data-rq-error]')!;
  const done = q<HTMLElement>(drawer, '[data-rq-done]')!;
  const submit = q<HTMLButtonElement>(form, '[data-rq-submit]')!;

  initGitHubConnect(() => paintAuth(drawer));
  paintAuth(drawer);

  drawer.addEventListener('click', (e) => {
    const opener = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-cm-change-open]');
    if (opener) openChange(drawer, opener);
  });
  document.addEventListener(INTENT_EVENT, (e) => {
    if (drawer.dataset.mode !== 'change') return;
    showIntent(drawer, (e as CustomEvent<{ value: ChangeIntent }>).detail.value);
  });
  box.querySelectorAll('[data-cm-chg-cancel]').forEach((b) => b.addEventListener('click', () => resetChangeFlow(drawer, true)));
  // "Ask a developer instead" and back ("Let Claude build it instead"): the same need; what she typed stays.
  q<HTMLElement>(form, '[data-cm-ask]')?.addEventListener('click', (e) => {
    const to = (e.currentTarget as HTMLElement).dataset.to;
    if (to !== 'ask' && to !== 'explore') return;
    paintMode(drawer, form, to);
    q<HTMLElement>(form, '[data-cm-form-title]')?.scrollIntoView({ block: 'nearest' });
    form.querySelector<HTMLInputElement>('[name="title"]')?.focus();
  });
  q(form, '[data-rq-add-row]')?.addEventListener('click', () => {
    const rows = form.querySelectorAll<HTMLElement>('[data-rq-change]');
    const last = rows[rows.length - 1]!;
    const next = last.cloneNode(true) as HTMLElement;
    next.querySelectorAll('input').forEach((i) => (i.value = ''));
    last.after(next);
    next.querySelector('input')?.focus();
  });
  form.addEventListener('input', (e) => {
    (e.target as HTMLElement).removeAttribute('aria-invalid');
    error.hidden = true;
  });
  // Image: a file picked with the button, or a screenshot pasted anywhere in the form.
  const file = q<HTMLInputElement>(form, '[data-rq-image-file]');
  q(form, '[data-rq-image-pick]')?.addEventListener('click', () => file?.click());
  file?.addEventListener('change', () => {
    const f = file.files?.[0];
    if (f) void setImage(form, f, error);
  });
  form.addEventListener('paste', (e) => {
    const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith('image/'));
    if (!f) return;
    e.preventDefault();
    void setImage(form, f, error);
  });
  q(form, '[data-rq-image-remove]')?.addEventListener('click', () => {
    clearImage(form);
    q<HTMLElement>(form, '[data-rq-image-pick]')?.focus();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const mode = (form.dataset.mode as ChangeFormMode | undefined) ?? 'mismatch';
    const values = readForm(form);
    const figmaRaw = ((form.elements.namedItem('figma') as HTMLInputElement | null)?.value ?? '').trim();
    const figmaProblem = figmaLinkProblem(figmaRaw);
    const problems = [...changeFormProblems(mode, values), ...(figmaProblem ? [figmaProblem] : [])];
    if (problems.length) {
      if (!values.title.trim()) form.querySelector('[name="title"]')?.setAttribute('aria-invalid', 'true');
      if (!values.summary.trim()) form.querySelector('[name="summary"]')?.setAttribute('aria-invalid', 'true');
      if (figmaProblem) form.querySelector('[name="figma"]')?.setAttribute('aria-invalid', 'true');
      error.textContent = problems.join(' ');
      error.hidden = false;
      form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      return;
    }
    const token = getToken();
    if (!token || !connected()) {
      error.textContent = `${ghAction('send it', prefersSignIn())}. Your text stays here.`;
      error.hidden = false;
      return;
    }
    const repo = readRepo();
    const copy = changeFormCopy(mode, drawer.dataset.component ?? 'component', prefersSignIn());
    setButtonBusy(submit, true, copy.busy);
    let sent: number | null = null;
    try {
      const gh = studioClient(`${repo.owner}/${repo.repo}`, token);
      const { created, request } = await sendRequest(gh, drawer, form, mode, values, figmaRaw);
      sent = created.number;
      if (mode !== 'explore') {
        resetChangeFlow(drawer);
        done.innerHTML = `<p><strong>${esc(sentLine(mode, created.number))}</strong></p>
          <p><a href="/studio/changes/?request=${created.number}">See it in Changes</a></p>`;
        done.hidden = false;
        return;
      }
      // Add a variant or option: the exploration Claude builds in, linked to the request, the designer on it.
      const ex = explorationFromRequest({ component: request.component, title: request.title, request });
      const author = currentViewer()?.login;
      const { started, link } = await startLinkedExploration(explorationsConfig(), { ...ex, ...(author ? { author } : {}) }, { number: created.number, title: created.title });
      const s = startedLines(ex.name, created.number);
      const warn = link && 'error' in link ? ` <span class="cg-muted">The request could not be linked to it: ${esc(link.error)}</span>` : '';
      resetChangeFlow(drawer);
      done.innerHTML = `<p><strong>${esc(s.lead)}</strong> ${esc(s.next)}${warn}</p>
        <p><a href="/studio/changes/?exploration=${started.pr}">Open the exploration</a></p>`;
      done.hidden = false;
    } catch (err) {
      if (sent !== null) {
        // The request exists: sending again would ask twice. Say so, and lead to the start from the request.
        resetChangeFlow(drawer);
        done.innerHTML = `<p><strong>Request #${sent} sent, but the exploration did not start.</strong> ${esc((err as Error).message)}</p>
          <p><a href="/studio/changes/?view=explorations&amp;for=${sent}">Start the exploration from the request</a></p>`;
        done.hidden = false;
        return;
      }
      showGhError(error, err, `GitHub did not take it: ${(err as Error).message} Check that your token can write issues on ${repo.owner}/${repo.repo}, then try again.`, 'create issues');
      error.hidden = false;
    } finally {
      setButtonBusy(submit, false, copy.submit);
    }
  });
}
