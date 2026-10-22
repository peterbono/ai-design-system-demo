// Library access (Settings, and the gate on a team's Library): who reads a team's Library, in designer words, and what a
// Library page shows a visitor. Pure: no DOM, no fetch, covered by library-access.test.ts. The server applies the same
// rules and is the one that decides (api/library-access/index.ts); the browser side is scripts/library-access-api.ts,
// the screens components/ds/studio/LibraryAccessSection.tsx and components/ds/library/LibraryGate.tsx.
//
// Two audiences: contributors sign in with GitHub and are invited from Members (Can edit, Reviewer, Admin); readers,
// the whole company, need no GitHub account and are let in here.

import { isSampleTeam } from './demo';

export type LibraryMode = 'anyone' | 'email' | 'team';

export const MODE_ORDER: readonly LibraryMode[] = ['anyone', 'email', 'team'];

/** Each choice as Settings shows it: the label, and one line on what it means for a reader. */
export const MODE_WORDS: Record<LibraryMode, { label: string; help: string }> = {
  anyone: { label: 'Anyone with the link', help: 'Everyone with the link reads the library. No sign-in.' },
  email: { label: 'Anyone with a work email at', help: 'Readers enter their work email and open the link Bridge sends them. No GitHub account needed.' },
  team: { label: 'Only the team', help: 'People with access on GitHub, signed in with GitHub.' },
};

/** What a team's setting is, as the server says it (publicSetting), or the default when nothing is stored. */
export interface AccessSetting {
  mode: LibraryMode;
  domains: string[];
  /** Where the Library is read from: GitHub (public, the raw host) or this site (private, after the session check). */
  source?: 'bridge' | 'github';
}

/** Without a stored setting a team keeps what GitHub allows: anyone for a public repository, the team for a private one. */
export const defaultSetting = (isPrivate: boolean): AccessSetting => ({ mode: isPrivate ? 'team' : 'anyone', domains: [] });

/** "acme.design" or "acme.design and acme.studio" or "a.co, b.co and c.co". */
export function domainList(domains: readonly string[]): string {
  if (domains.length <= 1) return domains[0] ?? '';
  return `${domains.slice(0, -1).join(', ')} and ${domains[domains.length - 1]}`;
}

/** The choice in one phrase: "Anyone with a work email at acme.design". */
export function settingLabel(s: AccessSetting): string {
  if (s.mode === 'email') return s.domains.length ? `${MODE_WORDS.email.label} ${domainList(s.domains)}` : MODE_WORDS.email.label;
  return MODE_WORDS[s.mode].label;
}

/** Settings words. */
export const ACCESS_WORDS = {
  title: 'Library access',
  intro: 'Who reads your design system library. Readers need no GitHub account; contributors still sign in with GitHub.',
  who: 'Who reads the library',
  link: 'Library link',
  copy: 'Copy library link',
  copied: 'Link copied',
  change: 'Change',
  save: 'Save',
  cancel: 'Cancel',
  domains: 'Work email domains',
  domainsHint: 'Separate several with a comma.',
  domainsPlaceholder: 'acme.design',
  readOnly: 'Only admins can change who reads the library.',
  unavailable: 'Library access is not available yet on this site. The library opens as GitHub allows: anyone for a public repository, the team for a private one.',
  publicRepo: 'The repository is public on GitHub, so its files stay readable there.',
  saved: (label: string) => `Saved. ${label} reads the library now.`,
  revokes: 'Saving a change signs out everyone who opened the library with their email.',
} as const;

// --- Domains ---------------------------------------------------------------------------------------------------

const DOMAIN = /^(?=.{4,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,63}$/;

/** Consumer providers the server refuses (api/library-access PUBLIC_EMAIL_DOMAINS keeps the same list). */
export const PUBLIC_EMAIL_DOMAINS: readonly string[] = [
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'yahoo.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'gmx.com',
  'gmx.net',
  'mail.com',
  'yandex.com',
  'zoho.com',
  'hey.com',
  'fastmail.com',
];

export const MAX_DOMAINS = 10;

/**
 * The domains an admin typed ("@Acme.design, acme.studio"), checked before saving: the list, or the first problem in
 * words. The server checks again.
 */
export function parseDomainField(text: string): { domains: string[] } | { error: string } {
  const out: string[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    const v = raw.trim().toLowerCase().replace(/^@/, '');
    if (!v) continue;
    if (!DOMAIN.test(v)) return { error: `${raw.trim()} is not an email domain. Write it like acme.design.` };
    if (PUBLIC_EMAIL_DOMAINS.includes(v)) return { error: `Anyone can get an email at ${v}. Pick your company domain, or choose Anyone with the link.` };
    if (!out.includes(v)) out.push(v);
  }
  if (!out.length) return { error: 'Add your company email domain, like acme.design.' };
  if (out.length > MAX_DOMAINS) return { error: `Add at most ${MAX_DOMAINS} domains.` };
  return { domains: out };
}

/** The part after the @ when it is one of `domains` (exact, case-insensitive), else null. The server decides. */
export function emailDomainIn(email: string, domains: readonly string[]): string | null {
  const m = /^[^\s@]+@([^\s@]+)$/.exec(email.trim());
  if (!m) return null;
  const d = m[1]!.toLowerCase();
  return domains.includes(d) ? d : null;
}

/** "This library is open to @acme.design emails. Ask your design system team for access." (the server's words too). */
export function wrongDomainWords(domains: readonly string[]): string {
  const list = domains.map((d) => `@${d}`);
  const names = list.length <= 1 ? (list[0] ?? '') : `${list.slice(0, -1).join(', ')} or ${list[list.length - 1]}`;
  return `This library is open to ${names} emails. Ask your design system team for access.`;
}

// --- Contexts --------------------------------------------------------------------------------------------------

/** Which Settings data a page shows: the sample team's (fixed, no call), a real team's, or none (no repository). */
export type AccessContext = 'sample' | 'real' | 'none';

export function accessContext(repo: string | null, noRepo: boolean): AccessContext {
  if (noRepo || !repo) return 'none';
  return isSampleTeam(repo) ? 'sample' : 'real';
}

/** Acme Design's sample setting: opened to its company's work emails, to show the choice (board-free, sample data). */
export const SAMPLE_SETTING: AccessSetting = { mode: 'email', domains: ['acme.design'] };

// --- The Library gate ------------------------------------------------------------------------------------------

/** What the server answers for a team (GET /api/library-access?repo=), or null when it cannot be asked. */
export interface AccessAnswer {
  available: boolean;
  setting: AccessSetting | null;
  session: { domain: string } | null;
}

/**
 * What a Library page shows:
 *   open         the Library, read as before (raw host for a public repository, GitHub sign-in for a private one)
 *   open-bridge  the Library, its published snapshot served by this site after the access check (private repository)
 *   email        "Enter your work email"
 *   team         "This library is open to its team", with Sign in with GitHub
 * The sample team and a site without the feature always open as before. A visitor signed in with GitHub reads with
 * their own access, as before; if GitHub refuses them, the page falls back to the email gate (LibraryState).
 */
export type GateKind = 'open' | 'open-bridge' | 'email' | 'team';

export function libraryGate(x: { sample: boolean; github: boolean; answer: AccessAnswer | null }): GateKind {
  if (x.sample || !x.answer?.available || !x.answer.setting) return 'open';
  if (x.github) return 'open';
  const s = x.answer.setting;
  const served = s.source === 'bridge';
  if (s.mode === 'anyone') return served ? 'open-bridge' : 'open';
  if (s.mode === 'team') return 'team';
  if (!x.answer.session) return 'email';
  return served ? 'open-bridge' : 'open';
}

/** The sign-in link's token, from the address the email leads to (#signin=<token>), or null. */
export function signInToken(hash: string): string | null {
  const m = /(?:^#|&)signin=([A-Za-z0-9_-]{43})(?:&|$)/.exec(hash);
  return m ? m[1]! : null;
}

/** "m•••@acme.design": enough to recognise the address on the "Check your inbox" screen. */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.trim().toLowerCase().split('@');
  return `${local.slice(0, 1)}•••@${domain}`;
}

/** The gate's words, per state. */
export const GATE_WORDS = {
  title: 'Read the design system library',
  emailLead: (domains: readonly string[]) => `This library is open to people with an ${domains.map((d) => `@${d}`).join(' or ')} email. Enter yours and Bridge sends you a link to open it.`,
  emailLabel: 'Work email',
  emailPlaceholder: 'name@company.com',
  send: 'Send me a link',
  badEmail: 'Enter your work email, like name@company.com.',
  sentTitle: 'Check your inbox',
  sentText: (masked: string) => `Bridge sent a link to ${masked}. Open it on this device. It works once, for 15 minutes.`,
  otherEmail: 'Use another email',
  expired: 'This link expired or was already used. Enter your email to get a new one.',
  unavailable: 'Email sign-in is not available yet on this site.',
  unavailableText: 'Ask your design system team how to read this library.',
  teamTitle: 'This library is open to its team',
  teamText: 'Sign in with GitHub with an account that has access to the repository. If you do not have one, ask your design system team.',
  teamAction: 'Sign in from Studio',
  network: 'Bridge did not answer. Check your connection and try again.',
} as const;
