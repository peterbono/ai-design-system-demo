// "Request a change" in the Studio Components drawer: an inline form that opens a GitHub issue labeled
// component-change with the reader's own token (composeRequestIssue from @bridge-ds/core, source "studio"), with the
// labels and assignees of bridge.config.json integrations.requests. It carries the Figma frame link and one image
// (pasted or picked), committed to the requests branch first, like the Figma plugin does. Without a token it only
// says how to connect.
import { REQUEST_KINDS, REQUESTS_BRANCH, composeRequestIssue, ensureRequestsBranch, requestImagePath } from '@bridge-ds/core';
import { requestFormProblems, requestFromForm, type RequestForm } from '../lib/requests-view';
import { base64Of, figmaFromLink, figmaLinkProblem, imageProblem, MAX_IMAGE_BYTES, requestImageUrl } from '../lib/request-attachments';
import { currentViewer, esc, getToken, hasWorkingToken, initGitHubConnect, readRepo, setButtonBusy, showGhError, studioClient } from './github-session';
import { forgetRequests, integrations } from './requests';

const q = <T extends HTMLElement>(root: ParentNode, sel: string) => root.querySelector<T>(sel);

function readForm(form: HTMLFormElement): RequestForm {
  const v = (name: string) => ((form.elements.namedItem(name) as HTMLInputElement | null)?.value ?? '').toString();
  return {
    kind: v('kind'),
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

/** Back to the closed state: the form hidden and emptied, the drawer showing the component again. */
export function resetRequestForm(drawer: HTMLElement, focusOpener = false) {
  const box = q<HTMLElement>(drawer, '[data-cm-req]');
  const form = q<HTMLFormElement>(drawer, '[data-cm-req-form]');
  const opener = q<HTMLButtonElement>(drawer, '[data-cm-req-open]');
  if (!box || !form) return;
  delete drawer.dataset.mode;
  form.reset();
  form.hidden = true;
  form.querySelectorAll('[data-rq-change]').forEach((row, i) => i > 0 && row.remove());
  form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
  const err = q<HTMLElement>(form, '[data-rq-error]');
  if (err) err.hidden = true;
  const hint = q<HTMLElement>(form, '[data-rq-kind-hint]');
  const kind = q<HTMLSelectElement>(form, '[data-rq-kind]');
  if (hint) hint.textContent = REQUEST_KINDS.find((k) => k.value === kind?.value)?.hint ?? '';
  clearImage(form);
  const done = q<HTMLElement>(box, '[data-rq-done]');
  if (done) done.hidden = true;
  opener?.setAttribute('aria-expanded', 'false');
  paintAuth(drawer);
  if (focusOpener && opener && !opener.hidden) opener.focus();
}

function paintAuth(drawer: HTMLElement) {
  const on = Boolean(hasWorkingToken() && currentViewer());
  drawer.querySelectorAll<HTMLElement>('[data-gh-only]').forEach((el) => (el.hidden = !on || (el.matches('[data-cm-req-open]') && drawer.dataset.mode === 'request')));
  drawer.querySelectorAll<HTMLElement>('[data-no-gh]').forEach((el) => (el.hidden = on));
  if (!on && drawer.dataset.mode === 'request') resetRequestForm(drawer);
}

export function initRequestForm(drawer: HTMLElement) {
  const box = q<HTMLElement>(drawer, '[data-cm-req]');
  const form = q<HTMLFormElement>(drawer, '[data-cm-req-form]');
  const opener = q<HTMLButtonElement>(drawer, '[data-cm-req-open]');
  if (!box || !form || !opener) return;
  const error = q<HTMLElement>(form, '[data-rq-error]')!;
  const done = q<HTMLElement>(box, '[data-rq-done]')!;
  const submit = q<HTMLButtonElement>(form, '[data-rq-submit]')!;
  const kind = q<HTMLSelectElement>(form, '[data-rq-kind]')!;
  const hint = q<HTMLElement>(form, '[data-rq-kind-hint]');

  initGitHubConnect(() => paintAuth(drawer));
  paintAuth(drawer);

  opener.addEventListener('click', () => {
    done.hidden = true;
    drawer.dataset.mode = 'request';
    form.hidden = false;
    opener.hidden = true;
    opener.setAttribute('aria-expanded', 'true');
    kind.focus();
  });
  q(form, '[data-rq-cancel]')?.addEventListener('click', () => {
    resetRequestForm(drawer, true);
  });
  kind.addEventListener('change', () => {
    if (hint) hint.textContent = REQUEST_KINDS.find((k) => k.value === kind.value)?.hint ?? '';
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
    const values = readForm(form);
    const figmaRaw = ((form.elements.namedItem('figma') as HTMLInputElement | null)?.value ?? '').trim();
    const figmaProblem = figmaLinkProblem(figmaRaw);
    const problems = [...requestFormProblems(values), ...(figmaProblem ? [figmaProblem] : [])];
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
    if (!token) {
      error.textContent = 'Connect GitHub to request changes.';
      error.hidden = false;
      return;
    }
    const component = drawer.dataset.component ?? 'Component';
    const slug = drawer.dataset.slug ?? '';
    const repo = readRepo();
    const cfg = integrations().requests ?? {};
    setButtonBusy(submit, true, 'Sending request');
    try {
      const gh = studioClient(`${repo.owner}/${repo.repo}`, token);
      // The image goes to the requests branch first, so the issue can show it.
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
      const request = { ...requestFromForm(component, values, currentViewer()?.login), ...(figma ? { figma } : {}), ...(urls.length ? { images: urls } : {}) };
      const issue = composeRequestIssue(request, {
        labels: cfg.labels ?? [],
        assignees: cfg.assignees ?? [],
        ...(slug ? { componentUrl: `${location.origin}/components/${slug}/` } : {}),
      });
      const created = await gh.createIssue(issue);
      forgetRequests();
      resetRequestForm(drawer);
      done.innerHTML = `<p><strong>Request #${created.number} sent.</strong> A developer builds it; the request closes when the change ships.</p>
        <p><a href="/studio/changes/?request=${created.number}">See it in Changes</a> · <a href="${esc(created.url)}" target="_blank" rel="noopener">Open #${created.number} on GitHub</a></p>`;
      done.hidden = false;
    } catch (err) {
      showGhError(error, err, `GitHub did not open the request: ${(err as Error).message} Check that your token can write issues on ${repo.owner}/${repo.repo}, then try again.`, 'create issues');
      error.hidden = false;
    } finally {
      setButtonBusy(submit, false, 'Send request');
    }
  });
}
