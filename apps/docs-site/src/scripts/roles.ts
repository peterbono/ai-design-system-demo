// Settings > Review rules and Safety: two edit-in-place forms (the design and tech owners, people or GitHub teams,
// picked in components/ds/studio/OwnersField; who approves design, who approves tech and who ships;
// when the visual before and after runs), each sent for review as a pull request on bridge.config.json with the
// reader's own token. Edit (or Change) swaps the row's value for a segmented control on the same row; "Request
// review" stays off until a value differs. A form sends its own values and the current ones of the other form. The
// file is read from the default branch as it is now and only `governance.owners`, `governance.rights` and `visualImpact` change
// (withRoles keeps the rest byte for byte). The tier comes from the shared classifier: bridge.config.json is a
// guardrail file.
// It also writes `changes` (how changes reach the code: suggestions or pull requests) the same way, for the Settings
// band and the onboarding step (proposeChangesMode), the team's display name `name` (proposeTeamName), and reads what the GitHub App may do on the repository.
import { classifyRisk, DEFAULT_RIGHTS, type Owners, type Rights, type VisualImpactMode } from '@bridge-ds/core';
import { choiceOf, groupsOf, roleRows, rolesProposal, sameOwners, withRoles, type RightChoice } from '../lib/roles-view';
import { selectSegment } from './shell';
import { getToken, ghGet, prefersSignIn, readRepo, readSignInConfig, sessionMode, setButtonBusy, setButtonDisabled, prLinksHtml, showGhError, studioClient } from './github-session';
import { ghAction } from '../lib/gh-wording';
import { canProposeSettings, changesProposal, GITHUB_WRITE_ONLY, withChanges, type AppPermissions } from '../lib/settings-view';
import { teamNameProposal, withTeamName } from '../lib/team-name';
import { installationFor, type InstallationLike } from '../lib/github-signin';
import type { ChangesMode } from '@bridge-ds/core';

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

/** The entries in an owners control (OwnersField): what is picked now ("value") or what the file says ("initial"). */
function entriesOf(c: HTMLElement, key: 'value' | 'initial'): string[] {
  try {
    const v = JSON.parse(c.dataset[key] ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** The owner list picked for a group, or the current one when its control is not on the page. */
function ownersIn(group: 'design' | 'tech'): string[] {
  const c = document.querySelector<HTMLElement>(`[data-owners-control][data-group="${group}"]`);
  return c ? entriesOf(c, 'value') : data().owners[group];
}

export function initRoles() {
  document.querySelectorAll<HTMLFormElement>('[data-roles-form]').forEach(initForm);
  gateSettingsWrites();
}

/**
 * Settings stored in the design system's files ([data-needs-write]): only a GitHub account that can edit the repository
 * proposes a change (lib/settings-view canProposeSettings). Anyone else reads the value and who changes it, never a
 * control that fails after the click (BR-20). Repainted when the access is known or changes.
 */
export function gateSettingsWrites(root: ParentNode = document) {
  void import('./github-session').then(({ onAccess }) =>
    onAccess((a) => {
      const can = canProposeSettings(a);
      root.querySelectorAll<HTMLElement>('[data-needs-write]').forEach((el) => {
        const off = can === false;
        el.hidden = off;
        let note = el.nextElementSibling as HTMLElement | null;
        if (!note?.hasAttribute('data-write-note')) {
          if (!off) return;
          note = document.createElement('p');
          note.className = 'set-row-help';
          note.setAttribute('data-write-note', '');
          note.textContent = GITHUB_WRITE_ONLY;
          el.after(note);
        }
        note.hidden = !off;
      });
    }),
  );
}

/** The value of a control: what the reader picked when it sits in the form being sent, else the current one. */
function valueIn(form: HTMLFormElement, selector: string): string {
  const c = document.querySelector<HTMLElement>(selector);
  if (!c) return '';
  return form.contains(c) ? selected(c) : (c.dataset.initial ?? '');
}

function initForm(form: HTMLFormElement) {
  const edit = document.querySelector<HTMLButtonElement>(`[data-roles-edit][aria-controls="${form.id}"]`);
  if (!edit) return;
  const error = form.querySelector<HTMLElement>('[data-roles-error]')!;
  const done = form.querySelector<HTMLElement>('[data-roles-done]')!;
  const submit = form.querySelector<HTMLButtonElement>('[data-roles-submit]')!;
  const cancel = form.querySelector<HTMLButtonElement>('[data-roles-cancel]')!;
  const help = form.querySelector<HTMLElement>('[data-visual-help]');
  const controls = () => [...form.querySelectorAll<HTMLElement>('[data-segmented-control][data-initial]')];
  const ownerControls = () => [...form.querySelectorAll<HTMLElement>('[data-owners-control]')];
  const ownersChanged = () => ownerControls().some((c) => !sameOwners(entriesOf(c, 'value'), entriesOf(c, 'initial')));
  const changed = () => controls().some((c) => selected(c) !== (c.dataset.initial ?? '')) || ownersChanged();
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
      document.dispatchEvent(new CustomEvent('bridge:owners-reset'));
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
  form.addEventListener('bridge:owners', () => {
    error.hidden = true;
    setButtonDisabled(submit, !changed());
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submit.disabled || !changed()) return;
    // A ship right the team never set has no segment selected: it keeps the default (tech owners).
    const pick = (right: keyof Rights) => {
      const v = valueIn(form, `[data-right="${right}"]`);
      return v ? groupsOf(v as RightChoice) : groupsOf(choiceOf(DEFAULT_RIGHTS[right]));
    };
    const rights: Rights = { approveDesign: pick('approveDesign'), approveTech: pick('approveTech'), ship: pick('ship') };
    const visualMode: VisualImpactMode = valueIn(form, '[data-visual-mode]') === 'on-demand' ? 'on-demand' : 'auto';
    // Owners: the people and teams picked in this form, only when they changed (the file keeps its own otherwise).
    const owners: Owners | undefined = ownersChanged() ? { design: ownersIn('design'), tech: ownersIn('tech') } : undefined;
    const token = getToken();
    if (!token) return fail(`${ghAction('request a review', prefersSignIn())}.`);
    const repo = readRepo();
    const d = data();
    setButtonBusy(submit, true, 'Requesting review');
    try {
      const gh = studioClient(`${repo.owner}/${repo.repo}`, token, {
        protectedBranches: [...new Set([...d.protectedBranches, 'main', 'master', repo.defaultBranch])],
        branchPrefix: d.prefix || undefined,
      });
      const current = await gh.getFileText(FILE, repo.defaultBranch);
      if (current === undefined) throw new Error('The repository has no Bridge settings file yet.');
      const next = withRoles(current, { rights, visualMode, ...(owners ? { owners } : {}) });
      if (next === current) return fail('This is already the current setting. Nothing to review.');
      const risk = classifyRisk({ files: [{ path: FILE, status: 'modified' }] });
      const p = rolesProposal(roleRows(owners ?? d.owners, rights), visualMode, { date: new Date(), prefix: d.prefix, tierLabel: `Tier ${risk.tier}${risk.reasons[0] ? ` (${risk.reasons[0]})` : ''}`, ...(owners ? { owners } : {}) });
      let branch = p.branch;
      for (let i = 2; await gh.getBranchSha(branch); i++) branch = `${p.branch}-${i}`;
      await gh.commitToNewBranch({ base: repo.defaultBranch, branch, message: p.message, files: [{ path: FILE, content: next }] });
      const pr = await gh.createPullRequest({ title: p.title, head: branch, base: repo.defaultBranch, body: p.body, draft: false });
      await gh.addLabels(pr.number, ['config', 'source: bridge-web', `tier-${risk.tier}`]).catch(() => false);
      done.innerHTML = `<p><strong>Sent for review.</strong> It applies once your team approves it.</p>
        <p>${prLinksHtml(pr)}</p>`;
      setEditing(false);
      done.hidden = false;
    } catch (err) {
      showGhError(error, err, `GitHub did not start the change: ${(err as Error).message}`, 'start changes');
      error.hidden = false;
    } finally {
      setButtonBusy(submit, false, 'Send for review');
      setButtonDisabled(submit, !changed());
    }
  });
}

/**
 * Opens a pull request that edits bridge.config.json with the reader's own token, and returns it: `edit` turns the
 * file as it is on the default branch into the new one, `proposal` gives the branch, title and body. Throws with a
 * sentence when there is nothing to change or GitHub refuses. Every config change from Studio goes through it.
 */
async function proposeConfig(
  edit: (current: string) => string,
  proposal: (tierLabel: string) => { branch: string; title: string; body: string; message: string },
  opts: { protectedBranches?: string[]; prefix?: string },
): Promise<{ number: number; url: string }> {
  const token = getToken();
  if (!token) throw new Error(`${ghAction('request a review', prefersSignIn())}.`);
  const repo = readRepo();
  const gh = studioClient(`${repo.owner}/${repo.repo}`, token, {
    protectedBranches: [...new Set([...(opts.protectedBranches ?? []), 'main', 'master', repo.defaultBranch])],
    branchPrefix: opts.prefix || undefined,
  });
  const current = await gh.getFileText(FILE, repo.defaultBranch);
  if (current === undefined) throw new Error('The repository has no Bridge settings file yet.');
  const next = edit(current);
  if (next === current) throw new Error('This is already the current setting. Nothing to review.');
  const risk = classifyRisk({ files: [{ path: FILE, status: 'modified' }] });
  const p = proposal(`Tier ${risk.tier}${risk.reasons[0] ? ` (${risk.reasons[0]})` : ''}`);
  let branch = p.branch;
  for (let i = 2; await gh.getBranchSha(branch); i++) branch = `${p.branch}-${i}`;
  await gh.commitToNewBranch({ base: repo.defaultBranch, branch, message: p.message, files: [{ path: FILE, content: next }] });
  const pr = await gh.createPullRequest({ title: p.title, head: branch, base: repo.defaultBranch, body: p.body, draft: false });
  await gh.addLabels(pr.number, ['config', 'source: bridge-web', `tier: ${risk.tier}`]).catch(() => false);
  return { number: pr.number, url: pr.url };
}

/** Opens the pull request that sets `changes` in bridge.config.json (Settings and the onboarding step). */
export function proposeChangesMode(mode: ChangesMode, opts: { prefix?: string; protectedBranches?: string[] } = {}): Promise<{ number: number; url: string }> {
  return proposeConfig(
    (current) => withChanges(current, mode),
    (tierLabel) => changesProposal(mode, { date: new Date(), prefix: opts.prefix, suggestApp: readSignInConfig()?.suggestApp ?? null, tierLabel }),
    opts,
  );
}

/** Opens the pull request that sets the team's display name, `name` in bridge.config.json (setup step, Settings > General). */
export function proposeTeamName(name: string, opts: { prefix?: string; protectedBranches?: string[] } = {}): Promise<{ number: number; url: string }> {
  return proposeConfig(
    (current) => withTeamName(current, name),
    (tierLabel) => teamNameProposal(name, { date: new Date(), prefix: opts.prefix, tierLabel }),
    opts,
  );
}

/** Signed in with the GitHub App: the permissions of its installation on the repository owner. Null when unknown. */
export async function readAppPermissions(): Promise<AppPermissions | null> {
  if (!getToken() || sessionMode() !== 'app') return null;
  try {
    const { data } = await ghGet<{ installations?: (InstallationLike & { permissions?: AppPermissions })[] }>('/user/installations?per_page=100');
    const list = data.installations ?? [];
    const found = installationFor(list, readRepo().owner);
    if (found.reach === 'no') return null;
    return list.find((i) => i.account?.login?.toLowerCase() === readRepo().owner.toLowerCase())?.permissions ?? null;
  } catch {
    return null;
  }
}
