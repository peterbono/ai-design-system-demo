// Settings > Roles: edit in place, then propose who approves design, who approves tech, who ships, and when the
// visual before and after runs, as a pull request on bridge.config.json with the reader's own token. Edit swaps
// each row's value for a segmented control on the same row; "Propose changes" stays off until a value differs. The
// file is read from the default branch as it is now and only `governance.rights` and `visualImpact` change
// (withRoles keeps the rest byte for byte). The tier comes from the shared classifier: bridge.config.json is a
// guardrail file.
import { classifyRisk, DEFAULT_RIGHTS, type Owners, type Rights, type VisualImpactMode } from '@bridge-ds/core';
import { choiceOf, groupsOf, roleRows, rolesProposal, withRoles, type RightChoice } from '../lib/roles-view';
import { selectSegment } from './shell';
import { esc, getToken, readRepo, setButtonBusy, setButtonDisabled, showGhError, studioClient } from './github-session';

const FILE = 'bridge.config.json';

interface RolesData {
  prefix: string;
  protectedBranches: string[];
  owners: Owners;
}

function data(): RolesData {
  try {
    return JSON.parse(document.getElementById('set-roles-data')?.textContent || '{}') as RolesData;
  } catch {
    return { prefix: '', protectedBranches: ['main', 'master'], owners: { design: [], tech: [] } };
  }
}

const selected = (root: Element | null) => root?.querySelector<HTMLElement>('[data-segment][aria-checked="true"]')?.dataset.value ?? '';

export function initRoles() {
  const form = document.querySelector<HTMLFormElement>('[data-roles-form]');
  const edit = document.querySelector<HTMLButtonElement>('[data-roles-edit]');
  if (!form || !edit) return;
  const error = form.querySelector<HTMLElement>('[data-roles-error]')!;
  const done = form.querySelector<HTMLElement>('[data-roles-done]')!;
  const submit = form.querySelector<HTMLButtonElement>('[data-roles-submit]')!;
  const cancel = form.querySelector<HTMLButtonElement>('[data-roles-cancel]')!;
  const help = form.querySelector<HTMLElement>('[data-visual-help]');
  const controls = () => [...form.querySelectorAll<HTMLElement>('[data-segmented-control][data-initial]')];
  const changed = () => controls().some((c) => selected(c) !== (c.dataset.initial ?? ''));
  const fail = (text: string) => {
    error.textContent = text;
    error.hidden = false;
  };
  const paintHelp = () => {
    if (!help) return;
    const mode = selected(form.querySelector('[data-visual-mode]'));
    help.textContent = (mode === 'on-demand' ? help.dataset.onDemand : help.dataset.auto) ?? help.textContent;
  };
  const setEditing = (on: boolean) => {
    form.dataset.editing = String(on);
    edit.hidden = on;
    error.hidden = true;
    if (on) {
      done.hidden = true;
      (form.querySelector<HTMLElement>('[data-segment][tabindex="0"]') ?? form.querySelector<HTMLElement>('[data-segment]'))?.focus();
    } else {
      for (const c of controls()) selectSegment(c, c.dataset.initial ?? '');
      paintHelp();
      edit.focus();
    }
    setButtonDisabled(submit, true);
  };

  edit.addEventListener('click', () => setEditing(true));
  cancel.addEventListener('click', () => setEditing(false));
  form.addEventListener('bridge:segment', () => {
    error.hidden = true;
    paintHelp();
    setButtonDisabled(submit, !changed());
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submit.disabled || !changed()) return;
    // A ship right the team never set has no segment selected: it keeps the default (tech owners).
    const pick = (right: keyof Rights) => {
      const v = selected(form.querySelector(`[data-right="${right}"]`));
      return v ? groupsOf(v as RightChoice) : groupsOf(choiceOf(DEFAULT_RIGHTS[right]));
    };
    const rights: Rights = { approveDesign: pick('approveDesign'), approveTech: pick('approveTech'), ship: pick('ship') };
    const visualMode: VisualImpactMode = selected(form.querySelector('[data-visual-mode]')) === 'on-demand' ? 'on-demand' : 'auto';
    const token = getToken();
    if (!token) return fail('Connect GitHub to propose these roles.');
    const repo = readRepo();
    const d = data();
    setButtonBusy(submit, true, 'Proposing');
    try {
      const gh = studioClient(`${repo.owner}/${repo.repo}`, token, {
        protectedBranches: [...new Set([...d.protectedBranches, 'main', 'master', repo.defaultBranch])],
        branchPrefix: d.prefix || undefined,
      });
      const current = await gh.getFileText(FILE, repo.defaultBranch);
      if (current === undefined) throw new Error('The repository has no Bridge settings file yet.');
      const next = withRoles(current, { rights, visualMode });
      if (next === current) return fail('These roles are already the current ones. Nothing to propose.');
      const risk = classifyRisk({ files: [{ path: FILE, status: 'modified' }] });
      const p = rolesProposal(roleRows(d.owners, rights), visualMode, { date: new Date(), prefix: d.prefix, tierLabel: `Tier ${risk.tier}${risk.reasons[0] ? ` (${risk.reasons[0]})` : ''}` });
      let branch = p.branch;
      for (let i = 2; await gh.getBranchSha(branch); i++) branch = `${p.branch}-${i}`;
      await gh.commitToNewBranch({ base: repo.defaultBranch, branch, message: p.message, files: [{ path: FILE, content: next }] });
      const pr = await gh.createPullRequest({ title: p.title, head: branch, base: repo.defaultBranch, body: p.body, draft: false });
      await gh.addLabels(pr.number, ['config', 'source: bridge-web', `tier-${risk.tier}`]).catch(() => false);
      done.innerHTML = `<p><strong>Proposed as change #${pr.number}.</strong> The roles apply once your team approves it.</p>
        <p><a href="/studio/changes/?pr=${pr.number}">Review #${pr.number}</a> · <a href="${esc(pr.url)}" target="_blank" rel="noopener">Open on GitHub</a></p>`;
      setEditing(false);
      done.hidden = false;
    } catch (err) {
      showGhError(error, err, `GitHub did not take the proposal: ${(err as Error).message}`, 'open pull requests');
      error.hidden = false;
    } finally {
      setButtonBusy(submit, false, 'Propose changes');
      setButtonDisabled(submit, !changed());
    }
  });
}
