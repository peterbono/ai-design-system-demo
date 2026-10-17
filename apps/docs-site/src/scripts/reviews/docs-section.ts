// The "Docs" section of a pull request in Studio Changes: each docs.json it changes, Claude drafts first with
// "Draft by Claude, needs review", Accept (commits needsReview false to the branch) and Edit (the docs editor on the
// branch). Accept needs a GitHub token with write access.
import { esc, ghGet } from '../github-session';
import { PR_DOC_PILL, prDocRows, prDocsEditHref, prDocsMeta, type PrDocRow } from '../../lib/pr-docs';

interface Ctx {
  owner: string;
  repo: string;
  pr: number;
  sha: string;
  branch: string;
  canWrite: boolean;
}

function rowHtml(r: PrDocRow, ctx: Ctx): string {
  const pill = PR_DOC_PILL[r.state];
  const accept = r.state === 'review' && ctx.canWrite ? `<button type="button" class="btn btn-secondary btn-sm" data-docs-accept="${esc(r.path)}" data-docs-name="${esc(r.name)}">Accept</button>` : '';
  const edit = r.state === 'unreadable' ? '' : `<a class="btn btn-secondary btn-sm" href="${esc(prDocsEditHref(r.slug, ctx.pr, ctx.branch))}">Edit</a>`;
  return `<li class="cg-doc" data-docs-row="${esc(r.path)}">
    <span class="cg-doc-main"><strong>${esc(r.name)}</strong><span class="cg-muted mono">${esc(r.path)}</span></span>
    <span class="pill ${pill.tone}" data-docs-pill>${esc(pill.label)}</span>
    <span class="cg-doc-acts">${accept}${edit}</span>
  </li>`;
}

export function renderDocsSection(paths: string[]): string {
  return `<div id="rv-docs"><p class="rv-loading">Reading ${paths.length} docs ${paths.length === 1 ? 'file' : 'files'}</p></div>`;
}

export async function loadDocsSection(slot: HTMLElement, paths: string[], ctx: Ctx, onAccept: (path: string, name: string) => Promise<string>) {
  const entries = await Promise.all(
    paths.map((path) =>
      ghGet<string>(`https://raw.githubusercontent.com/${ctx.owner}/${ctx.repo}/${ctx.sha}/${path}`, { raw: true })
        .then((r) => ({ path, text: r.data }))
        .catch(() => ({ path, text: null })),
    ),
  );
  const rows = prDocRows(entries);
  const meta = document.querySelector('#cg-sec-docs [data-sec-meta]');
  if (meta) meta.textContent = prDocsMeta(rows);
  const waiting = rows.some((r) => r.state === 'review');
  slot.innerHTML = `${waiting ? '<p class="cg-muted">Claude wrote these from the code. Read each one against the component, then accept it or edit it.</p>' : ''}<ul class="cg-docs">${rows.map((r) => rowHtml(r, ctx)).join('')}</ul>${
    waiting && !ctx.canWrite ? '<p class="cg-muted">Accept needs a GitHub token with write access to this repository.</p>' : ''
  }<p class="cg-muted" role="status" aria-live="polite" data-docs-status></p>`;
  if (waiting && slot.closest('details')) (slot.closest('details') as HTMLDetailsElement).open = true;
  slot.querySelectorAll<HTMLButtonElement>('[data-docs-accept]').forEach((b) =>
    b.addEventListener('click', async () => {
      const status = slot.querySelector<HTMLElement>('[data-docs-status]')!;
      b.disabled = true;
      status.textContent = `Accepting ${b.dataset.docsName}`;
      try {
        const sha = await onAccept(b.dataset.docsAccept!, b.dataset.docsName!);
        const row = b.closest('[data-docs-row]');
        const pill = row?.querySelector<HTMLElement>('[data-docs-pill]');
        if (pill) {
          pill.className = `pill ${PR_DOC_PILL.reviewed.tone}`;
          pill.textContent = PR_DOC_PILL.reviewed.label;
        }
        b.remove();
        status.textContent = sha ? `${b.dataset.docsName} accepted in ${sha.slice(0, 7)}.` : `${b.dataset.docsName} was already accepted.`;
      } catch (err) {
        b.disabled = false;
        status.textContent = `Not accepted: ${(err as Error).message}`;
      }
    }),
  );
}
