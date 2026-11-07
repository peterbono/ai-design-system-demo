// Check the build (board R4): the words of the step and who checks it, from what Bridge's server says
// (api/_lib/build-check.ts, action build-state). Pure: no DOM, no fetch. Designer words only: never a commit or a status.

export type BuildWhy = 'build' | 'design';
export type BuildRoleName = 'designer' | 'pm' | 'lead';

/** A row of the server's answer. */
export interface BuildRowRead {
  role: BuildRoleName;
  required: boolean;
  state: 'looks-right' | 'changes' | 'waiting';
  byName?: string;
  text?: string;
  why?: BuildWhy;
}

export interface BuildCheckRow {
  role: BuildRoleName;
  name: string;
  part: string;
  state: 'looks-right' | 'changes' | 'waiting' | 'not-needed';
  stateLine: string;
  note: string | null;
}

export interface BuildCheckView {
  line: string;
  builder: string;
  designer: string;
  rows: BuildCheckRow[];
  onSay?: ((a: { kind: 'looks-right' | 'changes'; why?: BuildWhy; text?: string }) => Promise<string | void>) | null;
  /** Under the answers: what an answer does. */
  note?: string | null;
}

export const BUILD_WORDS = {
  tag: 'Check the build',
  title: 'Ready to ship?',
  line: (builder: string) => `${builder} finished the build. Compare it with what was approved.`,
  looksRight: 'Looks right',
  needsChanges: 'Needs changes',
  whatChanges: 'What needs to change?',
  buildOff: 'The build is off',
  buildOffHint: (builder: string) => `Back to ${builder}, with your note.`,
  designChange: 'The design must change',
  designChangeHint: (designer: string) => `Back to ${designer}: a new round, then the lead again.`,
  note: 'Your note',
  send: 'Send',
  cancel: 'Cancel',
  sentOk: 'Sent: it looks right to you.',
  sentBuild: (builder: string) => `Sent to ${builder}, with your note.`,
  sentDesign: (designer: string) => `Sent. ${designer} gets your note for a new round.`,
  approved: 'Approved',
  openBuild: 'Open the build',
  openApproved: 'Approved version',
  builtBy: (builder: string) => `Built by ${builder}`,
  pushNote: 'A new version from the developers asks everyone again.',
} as const;

const PART: Record<BuildRoleName, string> = { designer: 'designer', pm: 'product manager', lead: 'design lead' };

/** The rows of who checks, named: the designer, the PM, the lead (not needed when no library piece changed). */
export function buildRows(rows: readonly BuildRowRead[], names: { designer: string; pm: string | null; lead: string | null }): BuildCheckRow[] {
  const out: BuildCheckRow[] = [];
  for (const role of ['designer', 'pm', 'lead'] as const) {
    const r = rows.find((x) => x.role === role);
    if (role === 'pm' && !r) continue;
    const name = r?.byName ?? (role === 'designer' ? names.designer : role === 'pm' ? (names.pm ?? 'The product manager') : (names.lead ?? 'A design lead'));
    const state = !r ? 'not-needed' : r.state;
    if (role === 'lead' && state === 'not-needed') {
      out.push({ role, name: names.lead ?? 'Design lead', part: names.lead ? PART[role] : '', state, stateLine: 'Not needed: no library piece changed', note: null });
      continue;
    }
    const stateLine = state === 'looks-right' ? 'Looks right' : state === 'changes' ? (r?.why === 'design' ? 'The design must change' : 'Needs changes') : 'Waiting';
    out.push({ role, name, part: PART[role], state, stateLine, note: state === 'changes' ? (r?.text ?? null) : null });
  }
  return out;
}
