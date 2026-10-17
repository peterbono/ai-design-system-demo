// "Request a change" in the Studio Components drawer: an inline form that opens a GitHub issue labeled
// component-change with the reader's own token (composeRequestIssue from @bridge-ds/core, source "studio"), with the
// labels and assignees of bridge.config.json integrations.requests. Without a token it only says how to connect.
import { REQUEST_KINDS, composeRequestIssue } from '@bridge-ds/core';
import { requestFormProblems, requestFromForm, type RequestForm } from '../lib/requests-view';
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
  if (hint) hint.textContent = REQUEST_KINDS[0]!.hint;
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

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const values = readForm(form);
    const problems = requestFormProblems(values);
    if (problems.length) {
      if (!values.title.trim()) form.querySelector('[name="title"]')?.setAttribute('aria-invalid', 'true');
      if (!values.summary.trim()) form.querySelector('[name="summary"]')?.setAttribute('aria-invalid', 'true');
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
    setButtonBusy(submit, true, 'Opening request');
    try {
      const gh = studioClient(`${repo.owner}/${repo.repo}`, token);
      const issue = composeRequestIssue(requestFromForm(component, values, currentViewer()?.login), {
        labels: cfg.labels ?? [],
        assignees: cfg.assignees ?? [],
        ...(slug ? { componentUrl: `${location.origin}/components/${slug}/` } : {}),
      });
      const created = await gh.createIssue(issue);
      forgetRequests();
      resetRequestForm(drawer);
      done.innerHTML = `<p><strong>Request #${created.number} opened.</strong> A developer, or Claude, implements it in a pull request that closes it.</p>
        <p><a href="${esc(created.url)}" target="_blank" rel="noopener">Open #${created.number} on GitHub</a> · <a href="/studio/changes/?request=${created.number}">See it in Changes</a></p>`;
      done.hidden = false;
    } catch (err) {
      showGhError(error, err, `GitHub did not open the request: ${(err as Error).message} Check that your token can write issues on ${repo.owner}/${repo.repo}, then try again.`, 'create issues');
      error.hidden = false;
    } finally {
      setButtonBusy(submit, false, 'Open request');
    }
  });
}
