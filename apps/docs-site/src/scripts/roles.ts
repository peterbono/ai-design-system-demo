// Settings > Roles: propose who approves design, who approves tech, who ships, and when the visual before and after
// runs, as a pull request on bridge.config.json with the reader's own token. The file is read from the default
// branch as it is now and only `governance.rights` and `visualImpact` change (withRoles keeps the rest byte for
// byte). The tier comes from the shared classifier: bridge.config.json is a guardrail file.
import { classifyRisk, type Owners, type Rights, type VisualImpactMode } from '@bridge-ds/core';
import { groupsOf, roleRows, rolesProposal, withRoles, type RightChoice } from '../lib/roles-view';
import { esc, getToken, readRepo, setButtonBusy, showGhError, studioClient } from './github-session';

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
  if (!form) return;
  const error = form.querySelector<HTMLElement>('[data-roles-error]')!;
  const done = form.querySelector<HTMLElement>('[data-roles-done]')!;
  const submit = form.querySelector<HTMLButtonElement>('[data-roles-submit]')!;
  const fail = (text: string) => {
    error.textContent = text;
    error.hidden = false;
  };
  form.addEventListener('bridge:segment', () => (error.hidden = true));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submit.getAttribute('aria-disabled') === 'true') return;
    const pick = (right: keyof Rights) => groupsOf((selected(form.querySelector(`[data-right="${right}"]`)) || 'tech') as RightChoice);
    const rights: Rights = { approveDesign: pick('approveDesign'), approveTech: pick('approveTech'), ship: pick('ship') };
    const visualMode: VisualImpactMode = selected(form.querySelector('[data-visual-mode]')) === 'on-demand' ? 'on-demand' : 'auto';
    const token = getToken();
    if (!token) return fail('Connect GitHub to propose these roles.');
    const repo = readRepo();
    const d = data();
    setButtonBusy(submit, true, 'Opening pull request');
    done.hidden = true;
    try {
      const gh = studioClient(`${repo.owner}/${repo.repo}`, token, {
        protectedBranches: [...new Set([...d.protectedBranches, 'main', 'master', repo.defaultBranch])],
        branchPrefix: d.prefix || undefined,
      });
      const current = await gh.getFileText(FILE, repo.defaultBranch);
      if (current === undefined) throw new Error(`${repo.defaultBranch} has no ${FILE}.`);
      const next = withRoles(current, { rights, visualMode });
      if (next === current) return fail(`${FILE} already says this. Nothing to propose.`);
      const risk = classifyRisk({ files: [{ path: FILE, status: 'modified' }] });
      const p = rolesProposal(roleRows(d.owners, rights), visualMode, { date: new Date(), prefix: d.prefix, tierLabel: `Tier ${risk.tier}${risk.reasons[0] ? ` (${risk.reasons[0]})` : ''}` });
      let branch = p.branch;
      for (let i = 2; await gh.getBranchSha(branch); i++) branch = `${p.branch}-${i}`;
      await gh.commitToNewBranch({ base: repo.defaultBranch, branch, message: p.message, files: [{ path: FILE, content: next }] });
      const pr = await gh.createPullRequest({ title: p.title, head: branch, base: repo.defaultBranch, body: p.body, draft: false });
      await gh.addLabels(pr.number, ['config', 'source: bridge-web', `tier-${risk.tier}`]).catch(() => false);
      done.innerHTML = `<p><strong>Pull request #${pr.number} opened.</strong> The roles change once it is approved and shipped.</p>
        <p><a href="/studio/changes/?pr=${pr.number}">Review #${pr.number}</a> · <a href="${esc(pr.url)}" target="_blank" rel="noopener">Open on GitHub</a></p>`;
      done.hidden = false;
    } catch (err) {
      showGhError(error, err, `GitHub did not open the pull request: ${(err as Error).message}`, 'open pull requests');
      error.hidden = false;
    } finally {
      setButtonBusy(submit, false, 'Propose changes');
    }
  });
}
