// Settings > Integrations: propose the Jira and request settings as a pull request on bridge.config.json, with the
// reader's own token. The file is read from the default branch as it is now and only `integrations` changes
// (format-preserving writer in lib/requests-view.ts), so the diff is that block. The tier comes from the shared
// classifier: bridge.config.json is a guardrail file. Secrets never go in the file.
import { classifyRisk } from '@bridge-ds/core';
import { integrationsFromForm, integrationsProblems, integrationsProposal, withIntegrations, type IntegrationsForm } from '../lib/requests-view';
import { esc, getToken, readRepo, setButtonBusy, showGhError, studioClient } from './github-session';

const FILE = 'bridge.config.json';

interface IntData {
  prefix: string;
  protectedBranches: string[];
  workflowUrl: string;
  secretsUrl: string;
}

function data(): IntData {
  try {
    return JSON.parse(document.getElementById('set-int-data')?.textContent || '{}') as IntData;
  } catch {
    return { prefix: '', protectedBranches: ['main', 'master'], workflowUrl: '', secretsUrl: '' };
  }
}

export function initIntegrations() {
  const form = document.querySelector<HTMLFormElement>('[data-int-form]');
  if (!form) return;
  const error = form.querySelector<HTMLElement>('[data-int-error]')!;
  const done = form.querySelector<HTMLElement>('[data-int-done]')!;
  const submit = form.querySelector<HTMLButtonElement>('[data-int-submit]')!;
  const v = (name: string) => (form.elements.namedItem(name) as HTMLInputElement | null)?.value ?? '';
  const fail = (text: string) => {
    error.textContent = text;
    error.hidden = false;
  };

  form.addEventListener('input', () => (error.hidden = true));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submit.getAttribute('aria-disabled') === 'true') return;
    const values: IntegrationsForm = { baseUrl: v('baseUrl'), project: v('project'), issueType: v('issueType'), jiraLabels: v('jiraLabels'), requestLabels: v('requestLabels'), assignees: v('assignees') };
    const block = integrationsFromForm(values);
    const problems = integrationsProblems(block);
    if (problems.length) return fail(problems.join(' '));
    const token = getToken();
    if (!token) return fail('Connect GitHub to send these settings for review.');
    const repo = readRepo();
    const d = data();
    setButtonBusy(submit, true, 'Sending for review');
    done.hidden = true;
    try {
      const gh = studioClient(`${repo.owner}/${repo.repo}`, token, {
        protectedBranches: [...new Set([...d.protectedBranches, 'main', 'master', repo.defaultBranch])],
        branchPrefix: d.prefix || undefined,
      });
      const current = await gh.getFileText(FILE, repo.defaultBranch);
      if (current === undefined) throw new Error(`${repo.defaultBranch} has no ${FILE}.`);
      const next = withIntegrations(current, block);
      if (next === current) return fail('These are already the current settings. Nothing to send.');
      const risk = classifyRisk({ files: [{ path: FILE, status: 'modified' }] });
      const p = integrationsProposal(block, { date: new Date(), prefix: d.prefix, tierLabel: `Tier ${risk.tier}${risk.reasons[0] ? ` (${risk.reasons[0]})` : ''}`, workflowUrl: d.workflowUrl, secretsUrl: d.secretsUrl });
      let branch = p.branch;
      for (let i = 2; await gh.getBranchSha(branch); i++) branch = `${p.branch}-${i}`;
      await gh.commitToNewBranch({ base: repo.defaultBranch, branch, message: p.message, files: [{ path: FILE, content: next }] });
      const pr = await gh.createPullRequest({ title: p.title, head: branch, base: repo.defaultBranch, body: p.body, draft: false });
      await gh.addLabels(pr.number, ['config', 'source: bridge-web', `tier-${risk.tier}`]).catch(() => false);
      done.innerHTML = `<p><strong>Sent for review.</strong> Jira starts once the change ships and a developer adds the secrets.</p>
        <p><a href="/studio/changes/?pr=${pr.number}">See the change</a> · <a href="${esc(pr.url)}" target="_blank" rel="noopener">Open on GitHub</a></p>`;
      done.hidden = false;
    } catch (err) {
      showGhError(error, err, `GitHub did not open the pull request: ${(err as Error).message}`, 'open pull requests');
      error.hidden = false;
    } finally {
      setButtonBusy(submit, false, 'Send for review');
    }
  });
}
