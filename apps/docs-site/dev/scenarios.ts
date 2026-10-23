// Audit scenarios S0 to S18 for `npm run dev:full` (docs/HOSTED.md, "Test everything locally"): `npm run dev:scenario
// <name>` clears the local accounts, teams, codes and outbox, then writes one scenario with the same storage functions
// the api/* functions use (accounts, members, invites, discovery, join requests) and, where a scenario needs it, the
// account function itself (sign-in codes). It prints the emails to sign in with and what each one should see.
//
// Fixture teams (acme/acme-product, lumen/brand-system...) do not exist on GitHub: dev/local-github.ts serves their
// files locally, read-only, so their Studio and Library pages load. Admins are seeded with api/_lib/local-admin.ts
// (local mode only), so admin screens work without a GitHub App.
//
// Team names: no fixture team is called "Acme Design", the name of the sample team of the demo
// (peterbono/bridge-demo-ds), so the audit never mistakes a real team for the demo.
//
// Dev only: loaded by dev/cli.mjs and the tests, never by the build.

import { randomBytes, randomUUID } from 'node:crypto';
import { type Account, putAccount } from '../api/_lib/account.js';
import type { EmailSender } from '../api/_lib/email.js';
import { b64url, sha256 } from '../api/_lib/http.js';
import { localAdminStore } from '../api/_lib/local-admin.js';
import { memberStore } from '../api/_lib/members.js';
import type { Redis } from '../api/_lib/redis.js';
import { JOIN_REQUEST_TTL_MS, putDiscovery, putRequest, putTeamName, putTeamRecord } from '../api/_lib/teams.js';
import { teamKeyOf } from '../src/lib/team-path.js';
import { handleAccount } from '../api/account/index.js';
import { INVITE_PATH, INVITE_TTL_MS, inviteEmail, inviteStoreOn, type ReviewAs, type Role } from '../api/invites/index.js';
import { putFixture } from './local-github.js';

export type EntryKind = 'teams' | 'invites' | 'domain' | 'create';

/** One person the auditor signs in as, and what /api/entry answers for them. */
export interface SignIn {
  email: string;
  name: string;
  /** The /api/entry kind right after the code. */
  kind: EntryKind;
  /** Where they land and what they see, in a sentence. */
  expect: string;
  /** For `teams`: how many teams, and the role on each ("owner/repo": role). */
  teams?: Record<string, 'edit' | 'admin'>;
}

/** The fixed id of the team made in Bridge of S17, so its address is the same every run. */
export const NO_REPO_TEAM_ID = 'c0ffee0000000017';

export interface ScenarioResult {
  signIns: SignIn[];
  /** Links the auditor opens (invite links), with what they show. */
  links: { url: string; expect: string }[];
  notes: string[];
}

export interface SeedContext {
  redis: Redis;
  now: number;
  /** Where invite emails go (the local outbox). */
  outbox: EmailSender;
  /** The site the links point to. */
  origin: string;
  /** The local session secret: sign-in codes are keyed with it (S16). */
  secret: string;
}

export interface Scenario {
  id: string;
  slug: string;
  title: string;
  run(ctx: SeedContext): Promise<ScenarioResult>;
}

// ---------------------------------------------------------------------------------------------------------------
// The cast

interface Person {
  email: string;
  name: string;
}

const P = {
  sam: { email: 'sam@acme.com', name: 'Sam Rivera' },
  priya: { email: 'priya@acme.com', name: 'Priya Shah' },
  leo: { email: 'leo@acme.com', name: 'Leo Martin' },
  olivia: { email: 'olivia@acme.com', name: 'Olivia Grant' },
  ben: { email: 'ben@acme.com', name: 'Ben Ortiz' },
  marcus: { email: 'marcus@acme.com', name: 'Marcus Hale' },
  riley: { email: 'riley@acme.com', name: 'Riley Chen' },
  taylor: { email: 'taylor@acme.com', name: 'Taylor Brooks' },
  mia: { email: 'mia@acme.com', name: 'Mia Rossi' },
  miaGmail: { email: 'mia.rossi@gmail.com', name: 'Mia Rossi' },
  noah: { email: 'noah@acme.com', name: 'Noah Kim' },
  ava: { email: 'ava@acme.com', name: 'Ava Patel' },
  jamie: { email: 'jamie@acme.com', name: 'Jamie Lee' },
  ana: { email: 'ana@acme.com', name: 'Ana Souza' },
  kenji: { email: 'kenji@acme.com', name: 'Kenji Watanabe' },
  fatima: { email: 'fatima@acme.com', name: 'Fatima Noor' },
  hugo: { email: 'hugo@acme.com', name: 'Hugo Laurent' },
  ines: { email: 'ines@lumen.studio', name: 'Ines Duarte' },
  theo: { email: 'theo@lumen.studio', name: 'Theo Becker' },
  nora: { email: 'nora@lumen.studio', name: 'Nora Lind' },
  chris: { email: 'chris@lumen.studio', name: 'Chris Morgan' },
  casey: { email: 'casey@lumen.studio', name: 'Casey Wu' },
  late: { email: 'late@lumen.studio', name: 'Robin Ash' },
  limit: { email: 'limit@lumen.studio', name: 'Sasha Vale' },
  alex: { email: 'alex.kim@gmail.com', name: 'Alex Kim' },
  jordan: { email: 'jordan@northwind.io', name: 'Jordan Blake' },
  dee: { email: 'dee@northwind.io', name: 'Dee Okafor' },
  sol: { email: 'sol@northwind.io', name: 'Sol Reyes' },
  kai: { email: 'kai@northwind.io', name: 'Kai Ito' },
} satisfies Record<string, Person>;

const LUMEN_PEOPLE: Person[] = [
  { email: 'ella@lumen.studio', name: 'Ella Novak' },
  { email: 'omar@lumen.studio', name: 'Omar Haddad' },
  { email: 'june@lumen.studio', name: 'June Park' },
  { email: 'felix@lumen.studio', name: 'Felix Moreau' },
  { email: 'zoe@lumen.studio', name: 'Zoe Adams' },
];

/** A team of the scenarios: its address, its name (bridge.config.json `name` in its fixture files), its admin. */
interface TeamDef {
  repo: string;
  name: string;
  admin: Person;
  members: Person[];
}

const T = {
  product: { repo: 'acme/acme-product', name: 'Acme Product', admin: P.sam, members: [P.priya, P.leo] },
  mobile: { repo: 'acme/acme-mobile', name: 'Acme Mobile', admin: P.olivia, members: [P.ben] },
  web: { repo: 'acme/acme-web', name: 'Acme Web', admin: P.marcus, members: [] },
  labs: { repo: 'acme/acme-labs', name: 'Acme Labs', admin: P.riley, members: [] },
  brand: { repo: 'lumen/brand-system', name: 'Lumen Brand', admin: P.ines, members: LUMEN_PEOPLE },
  lmobile: { repo: 'lumen/mobile-kit', name: 'Lumen Mobile', admin: P.ines, members: LUMEN_PEOPLE.slice(0, 3) },
  lweb: { repo: 'lumen/web-platform', name: 'Lumen Web', admin: P.theo, members: LUMEN_PEOPLE.slice(0, 2) },
  marketing: { repo: 'lumen/marketing-site', name: 'Lumen Marketing', admin: P.theo, members: LUMEN_PEOPLE.slice(3, 4) },
  email: { repo: 'lumen/email-kit', name: 'Lumen Email', admin: P.ines, members: [] },
} satisfies Record<string, TeamDef>;

// ---------------------------------------------------------------------------------------------------------------
// Seeding, with the functions api/* uses

const DAY = 24 * 60 * 60 * 1000;
const iso = (t: number) => new Date(t).toISOString();

export class Seed {
  constructor(readonly ctx: SeedContext) {}

  private readonly accounts = new Set<string>();

  async account(p: Person): Promise<void> {
    const email = p.email.toLowerCase();
    if (this.accounts.has(email)) return;
    this.accounts.add(email);
    const a: Account = { id: randomUUID(), email, name: p.name, github: null, createdAt: iso(this.ctx.now - 30 * DAY), version: 1 };
    await putAccount(this.ctx.redis, a);
  }

  async member(repo: string, p: Person, addedBy = 'local-seed', ago = 10 * DAY, role: 'edit' | 'admin' = 'edit'): Promise<void> {
    await this.account(p);
    await memberStore(this.ctx.redis).put(repo, { email: p.email.toLowerCase(), name: p.name, role, version: 1, addedBy, at: iso(this.ctx.now - ago) });
  }

  /**
   * A team made in Bridge ("Create your team"), no repository yet: its record, its name, its creator as its email
   * admin (no GitHub, no local admin seat: the real thing) and its members. Returns its key, `_team/<id>`.
   */
  async teamWithoutRepo(id: string, name: string, admin: Person, members: Person[]): Promise<string> {
    const key = teamKeyOf(id);
    const createdAt = iso(this.ctx.now - 3 * DAY);
    await putTeamRecord(this.ctx.redis, { id, name, createdBy: admin.email.toLowerCase(), createdAt, repo: null, storybook: null });
    await putTeamName(this.ctx.redis, key, name, this.ctx.now);
    await this.member(key, admin, admin.name, 3 * DAY, 'admin');
    for (const [i, m] of members.entries()) await this.member(key, m, admin.name, (2 - i * 0.1) * DAY);
    return key;
  }

  /** The team, its fixture files, its admin (a seeded local admin, also an email member) and its members. */
  async team(t: TeamDef): Promise<void> {
    await putFixture(this.ctx.redis, { repo: t.repo, name: t.name });
    await this.member(t.repo, t.admin, 'local-seed', 60 * DAY);
    await localAdminStore(this.ctx.redis).add(t.repo, t.admin.email);
    for (const [i, m] of t.members.entries()) await this.member(t.repo, m, t.admin.name, (20 - i) * DAY);
  }

  /** Discovery chosen by the team's admin: open (or closed) to their work domain. */
  async discovery(t: TeamDef, enabled: boolean): Promise<void> {
    const domain = t.admin.email.split('@')[1]!;
    await putDiscovery(this.ctx.redis, t.repo, { domain, enabled, byGithubId: 0, byLogin: 'local-admin', byName: t.admin.name, at: iso(this.ctx.now - 7 * DAY) });
  }

  /** A pending join request from `p` (an account), made `ago` ms before now, expiring `ttl` ms after it was made. */
  async request(t: TeamDef, p: Person, ago = 2 * 3_600_000, ttl = JOIN_REQUEST_TTL_MS): Promise<void> {
    await this.account(p);
    const created = this.ctx.now - ago;
    await putRequest(
      this.ctx.redis,
      { id: randomBytes(8).toString('hex'), repo: t.repo, email: p.email.toLowerCase(), name: p.name, createdAt: iso(created), expiresAt: iso(created + ttl) },
      this.ctx.now,
    );
  }

  /**
   * An invite from the team's admin to `email`, stored as api/invites stores it, its email in the outbox. `expired`:
   * it expired yesterday (kept a day in storage, so its link still says it expired). Returns the invite link.
   */
  async invite(t: TeamDef, email: string, role: Role = 'edit', opts: { reviewAs?: ReviewAs; expired?: boolean } = {}): Promise<string> {
    await this.account(t.admin);
    const token = b64url(randomBytes(32));
    const link = `${this.ctx.origin}${INVITE_PATH}#t=${token}`;
    const created = opts.expired ? this.ctx.now - 8 * DAY : this.ctx.now - 3_600_000;
    const expiresAt = opts.expired ? this.ctx.now - DAY : created + INVITE_TTL_MS;
    const inv = {
      id: randomBytes(8).toString('hex'),
      repo: t.repo,
      email: email.toLowerCase(),
      role,
      ...(opts.reviewAs ? { reviewAs: opts.reviewAs } : {}),
      invitedBy: 'local-admin',
      invitedByName: t.admin.name,
      createdAt: iso(created),
      sentAt: iso(created),
      expiresAt: iso(expiresAt),
      tokenHash: sha256(token),
    };
    const ttl = opts.expired ? DAY / 1000 : (expiresAt - this.ctx.now) / 1000;
    await inviteStoreOn(this.ctx.redis, () => this.ctx.now).put(inv, ttl);
    await this.ctx.outbox.send(inviteEmail({ to: inv.email, inviter: t.admin.name, repo: t.repo, team: t.name, role, ...(opts.reviewAs ? { reviewAs: opts.reviewAs } : {}), link }));
    return link;
  }

  /** Asks the account function for a sign-in code, as the sign-in screen does (the code lands in the outbox). */
  async askCode(email: string, code: string): Promise<number> {
    const origin = this.ctx.origin;
    const req = new Request(`${origin}/api/account`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Bridge-Account': '1', 'X-Forwarded-For': '203.0.113.16' },
      body: JSON.stringify({ action: 'code', email }),
    });
    const res = await handleAccount(req, { LIBRARY_SESSION_SECRET: this.ctx.secret }, { fetch: () => Promise.reject(new Error('offline')), redis: this.ctx.redis, email: this.ctx.outbox, code: () => code, now: () => this.ctx.now });
    return res.status;
  }

  /** Every live sign-in code of the store expires in `seconds` (the code keys of api/account, found by pattern). */
  async expireCodes(seconds: number): Promise<void> {
    const [, keys] = (await this.ctx.redis.cmd('SCAN', '0', 'MATCH', 'bridge:account:code*', 'COUNT', 1000)) as [string, string[]];
    for (const k of keys) if (/^bridge:account:(code|codefor):/.test(k)) await this.ctx.redis.cmd('EXPIRE', k, seconds);
  }
}

const teamsOf = (...pairs: [TeamDef, 'edit' | 'admin'][]): Record<string, 'edit' | 'admin'> => Object.fromEntries(pairs.map(([t, r]) => [t.repo, r]));
const result = (signIns: SignIn[], notes: string[] = [], links: ScenarioResult['links'] = []): ScenarioResult => ({ signIns, links, notes });

// ---------------------------------------------------------------------------------------------------------------
// S0 to S16 (the audit method, scratchpad e2e-method.md)

export const SCENARIOS: Scenario[] = [
  {
    id: 'S0',
    slug: 'empty',
    title: 'Empty: no account, no team',
    async run() {
      return result([{ ...P.taylor, kind: 'create', expect: 'Any email creates an account and lands on "Create your team" (E6).' }], ['Visitor journeys (landing, demo, Library, privacy) start here.']);
    },
  },
  {
    id: 'S1',
    slug: 'public-email',
    title: 'Public email, nothing yet',
    async run(ctx) {
      const s = new Seed(ctx);
      await s.team(T.product);
      await s.discovery(T.product, true);
      return result(
        [{ ...P.alex, kind: 'create', expect: 'A Gmail address never matches a team: "Create your team"; the discovery option says teams open to a work email only.' }],
        ['Acme Product is open to acme.com, to show a public email never sees it.'],
      );
    },
  },
  {
    id: 'S2',
    slug: 'work-email',
    title: 'Work email, nothing on its domain',
    async run(ctx) {
      const s = new Seed(ctx);
      await s.team(T.product);
      await s.discovery(T.product, true);
      return result(
        [{ ...P.jordan, kind: 'create', expect: '"Create your team", with "Let people with @northwind.io find this team" offered.' }],
        ['Acme Product is open to acme.com only: northwind.io sees nothing.'],
      );
    },
  },
  {
    id: 'S3',
    slug: 'domain-one',
    title: 'Work domain with one team open to it',
    async run(ctx) {
      const s = new Seed(ctx);
      await s.team(T.product);
      await s.discovery(T.product, true);
      return result([
        { ...P.taylor, kind: 'domain', expect: '"Your colleagues already use Bridge" (E4): one card, Acme product, Admin: Sam Rivera, 3 members. Ask to join, then "Request sent" (E4b).' },
        { ...P.sam, kind: 'teams', teams: teamsOf([T.product, 'admin']), expect: 'Admin: straight to the Acme Product home; Taylor\'s request shows there once sent (J7).' },
      ]);
    },
  },
  {
    id: 'S4',
    slug: 'domain-five',
    title: 'Work domain with five teams open to it',
    async run(ctx) {
      const s = new Seed(ctx);
      for (const t of [T.brand, T.lmobile, T.lweb, T.marketing, T.email]) {
        await s.team(t);
        await s.discovery(t, true);
      }
      await s.team(T.product);
      await s.discovery(T.product, true);
      return result(
        [{ ...P.nora, kind: 'domain', expect: 'E4 with five Lumen teams, largest first (Brand 6, Mobile 4, Web 3, Marketing 2, Email 1): three cards, then "Show 2 more teams".' }],
        ['Acme Product is open to acme.com and must not show for lumen.studio.'],
      );
    },
  },
  {
    id: 'S5',
    slug: 'domain-closed',
    title: 'Teams on the domain, none open to it',
    async run(ctx) {
      const s = new Seed(ctx);
      await s.team(T.product);
      await s.discovery(T.product, false);
      await s.team(T.mobile);
      return result(
        [{ ...P.taylor, kind: 'create', expect: '"Create your team": Acme Product was opened then closed, Acme Mobile never opened. Neither is named anywhere.' }],
        ['POST /api/entry { action: "request", repo: "acme/acme-product" } answers 404, like a team that does not exist.'],
      );
    },
  },
  {
    id: 'S6',
    slug: 'invite',
    title: 'Valid email invite, Can edit',
    async run(ctx) {
      const s = new Seed(ctx);
      await s.team(T.product);
      const link = await s.invite(T.product, P.mia.email);
      return result(
        [{ ...P.mia, kind: 'invites', expect: '"Acme Product invited you" (E3), Sam Rivera invited, You join as Can edit. Join lands on the team home, signed in with the account.' }],
        ['The invite email is in the outbox (/api/dev/outbox).'],
        [{ url: link, expect: 'The invite link: "Join Acme Product", the code goes to m•••@acme.com, then the name, then E3 and the team. Signed in as mia: E3 at once.' }],
      );
    },
  },
  {
    id: 'S7',
    slug: 'invite-expired',
    title: 'Expired invite',
    async run(ctx) {
      const s = new Seed(ctx);
      await s.team(T.product);
      const link = await s.invite(T.product, P.mia.email, 'edit', { expired: true });
      return result(
        [{ ...P.mia, kind: 'create', expect: 'The expired invite is not offered: "Create your team" (with "Expecting an invite?").' }],
        [],
        [{ url: link, expect: 'The invite link says it no longer works and to ask Sam Rivera for a new one, with Sign in.' }],
      );
    },
  },
  {
    id: 'S8',
    slug: 'invite-other-email',
    title: 'Invite sent to another email',
    async run(ctx) {
      const s = new Seed(ctx);
      await s.team(T.product);
      const link = await s.invite(T.product, P.mia.email);
      await s.account(P.miaGmail);
      return result(
        [
          { ...P.miaGmail, kind: 'create', expect: 'Signed in with the Gmail address: no invite for it, "Create your team". Opening the link says it was sent to m•••@acme.com.' },
          { ...P.mia, kind: 'invites', expect: 'Control: the invited address sees "Acme Product invited you".' },
        ],
        [],
        [{ url: link, expect: 'Open it while signed in as mia.rossi@gmail.com: "This invite was sent to m•••@acme.com", Sign in as that email.' }],
      );
    },
  },
  {
    id: 'S9',
    slug: 'invite-reviewer-admin',
    title: 'Reviewer invite (needs GitHub) and admin invite (email only)',
    async run(ctx) {
      const s = new Seed(ctx);
      await s.team(T.product);
      const rev = await s.invite(T.product, P.noah.email, 'reviewer', { reviewAs: 'design' });
      const adm = await s.invite(T.product, P.ava.email, 'admin');
      return result(
        [
          { ...P.noah, kind: 'invites', expect: 'E3 as Reviewer: design. The GitHub step shows before any Join (reviewers approve on GitHub); without GitHub sign-in on the site, it says it is not available here and to ask Sam Rivera.' },
          { ...P.ava, kind: 'invites', expect: 'E3 as Admin: Join works with the email, no GitHub. Ava lands on the team as Admin and manages Members.' },
        ],
        ['Connecting GitHub itself needs a GitHub App (not in local mode): the reviewer audit stops at the explanation.'],
        [
          { url: rev, expect: 'Reviewer invite link: the code to n•••@acme.com, then E3 with the GitHub step.' },
          { url: adm, expect: 'Admin invite link: the code to a•••@acme.com, then E3: Join with the email, no GitHub.' },
        ],
      );
    },
  },
  {
    id: 'S10',
    slug: 'member-one',
    title: 'Member of one team',
    async run(ctx) {
      const s = new Seed(ctx);
      await s.team(T.product);
      return result([{ ...P.priya, kind: 'teams', teams: teamsOf([T.product, 'edit']), expect: 'Straight to the Acme Product home as Can edit: only the work waiting on her, no review queue.' }]);
    },
  },
  {
    id: 'S11',
    slug: 'member-three',
    title: 'Member of three teams',
    async run(ctx) {
      const s = new Seed(ctx);
      for (const t of [T.brand, T.lmobile, T.lweb]) {
        await s.team(t);
        await s.member(t.repo, P.chris);
      }
      return result(
        [{ ...P.chris, kind: 'teams', teams: teamsOf([T.brand, 'edit'], [T.lmobile, 'edit'], [T.lweb, 'edit']), expect: 'No recent team in this browser: "Pick a team" (E5). With a recent team: straight to it.' }],
        [
          'Recent team is per browser (localStorage, never the server). Before signing in, in the page console:',
          '  localStorage.setItem("bridge.recentTeams", JSON.stringify(["lumen/mobile-kit"]))',
          'Without it (new profile, or localStorage.removeItem("bridge.recentTeams")): the picker. Opening a team page sets it too.',
        ],
      );
    },
  },
  {
    id: 'S12',
    slug: 'admin-requests',
    title: 'Admins with 4, 1 and 0 join requests',
    async run(ctx) {
      const s = new Seed(ctx);
      for (const t of [T.product, T.mobile, T.web]) {
        await s.team(t);
        await s.discovery(t, true);
      }
      const hours = [26, 20, 5, 1];
      for (const [i, p] of [P.jamie, P.ana, P.kenji, P.fatima].entries()) await s.request(T.product, p, hours[i]! * 3_600_000);
      await s.request(T.mobile, P.hugo, 3 * 3_600_000);
      return result([
        { ...P.sam, kind: 'teams', teams: teamsOf([T.product, 'admin']), expect: 'Acme Product home: 4 join requests, folded (more than 3: "Review all", no row buttons). Settings, Members lists them.' },
        { ...P.olivia, kind: 'teams', teams: teamsOf([T.mobile, 'admin']), expect: 'Acme Mobile home: Hugo Laurent asks to join, inline Approve and Decline.' },
        { ...P.marcus, kind: 'teams', teams: teamsOf([T.web, 'admin']), expect: 'Acme Web home: no request row. Settings shows discovery on for @acme.com.' },
      ]);
    },
  },
  {
    id: 'S13',
    slug: 'own-request',
    title: 'Own pending request (cancel, expire)',
    async run(ctx) {
      const s = new Seed(ctx);
      for (const t of [T.product, T.mobile]) {
        await s.team(t);
        await s.discovery(t, true);
      }
      await s.request(T.product, P.taylor, 3_600_000);
      // Made 14 days minus 3 minutes ago: it expires 3 minutes after the scenario ran.
      await s.request(T.mobile, P.taylor, JOIN_REQUEST_TTL_MS - 3 * 60_000);
      return result(
        [{ ...P.taylor, kind: 'domain', expect: 'E4 with both teams marked "Request sent". Cancel the Acme Product one. The Acme Mobile one expires 3 minutes after the scenario ran: reload after that, it asks again.' }],
        ['Run the scenario again to restart the 3 minutes.'],
      );
    },
  },
  {
    id: 'S14',
    slug: 'request-and-invite',
    title: 'Request and invite for the same team',
    async run(ctx) {
      const s = new Seed(ctx);
      await s.team(T.product);
      await s.discovery(T.product, true);
      await s.request(T.product, P.taylor, 5 * 3_600_000);
      const link = await s.invite(T.product, P.taylor.email);
      return result(
        [{ ...P.taylor, kind: 'invites', expect: 'The invite wins (E3): Join lands on the team, and the pending request is gone (Sam no longer sees it).' }],
        [],
        [{ url: link, expect: 'The same invite by its link.' }],
      );
    },
  },
  {
    id: 'S15',
    slug: 'last-admin',
    title: 'Last admin deletes their account',
    async run(ctx) {
      const s = new Seed(ctx);
      await s.team(T.product);
      await s.team(T.labs);
      return result([
        { ...P.sam, kind: 'teams', teams: teamsOf([T.product, 'admin']), expect: 'Delete account is refused (409 last-admin): Sam is the only admin of Acme Product, which has 2 other members. The message says what to do first.' },
        { ...P.riley, kind: 'teams', teams: teamsOf([T.labs, 'admin']), expect: 'Only admin of Acme Labs, alone on it: delete works; signing in again lands on "Create your team".' },
      ]);
    },
  },
  {
    id: 'S16',
    slug: 'codes',
    title: 'Sign-in code edge cases',
    async run(ctx) {
      const s = new Seed(ctx);
      await s.team(T.lmobile);
      await s.member(T.lmobile.repo, P.casey);
      await s.account(P.late);
      await s.account(P.limit);
      for (let i = 0; i < 5; i++) await s.askCode(P.limit.email, '444444');
      await s.askCode(P.late.email, '222222');
      await s.expireCodes(60);
      await s.askCode(P.casey.email, '111111');
      return result(
        [
          { ...P.casey, kind: 'teams', teams: teamsOf([T.lmobile, 'edit']), expect: 'A live code 111111 waits (10 minutes). Wrong code 5 times: "used too many times", then 111111 no longer works. Resend: a new code in the outbox, 111111 stops working.' },
          { ...P.late, kind: 'create', expect: 'Code 222222 expires 60 seconds after the scenario ran: after that, it answers "expired" with a way to get a new one.' },
          { ...P.limit, kind: 'create', expect: 'Already 5 codes today: "Send code" answers the daily limit (429) in words.' },
        ],
        ['111111 and 222222 are in the outbox too. Any other sign-in: read its code at /api/dev/outbox.'],
      );
    },
  },
  {
    id: 'S17',
    slug: 'team-no-repo',
    title: 'Team created in Bridge, no repository yet',
    async run(ctx) {
      const s = new Seed(ctx);
      const key = await s.teamWithoutRepo(NO_REPO_TEAM_ID, 'Northwind Design', P.jordan, [P.dee]);
      await putDiscovery(ctx.redis, key, { domain: 'northwind.io', enabled: true, byGithubId: 0, byLogin: '', byName: P.jordan.name, at: iso(ctx.now - 3 * DAY) });
      await s.request({ repo: key, name: 'Northwind Design', admin: P.jordan, members: [] }, P.sol, 2 * 3_600_000);
      return result(
        [
          {
            ...P.jordan,
            kind: 'teams',
            teams: { [key]: 'admin' },
            expect: 'Lands on the Northwind Design home (/studio/workspace/?team=...): the chip says Northwind Design, the home says what to connect next, Sol Reyes asks to join. The checklist says "Your team: Done".',
          },
          { ...P.dee, kind: 'teams', teams: { [key]: 'edit' }, expect: 'Same home as a member: no connect action, "An admin connects the design system".' },
          { ...P.kai, kind: 'domain', expect: 'E4: Northwind Design, Admin: Jordan Blake, 2 members. Ask to join.' },
        ],
        [
          'Settings > Account as Jordan: Delete my account says at once that Jordan is the only admin of Northwind Design, with "Make Dee Okafor admin".',
          'Linking a repository needs GitHub (an admin of it): not in local mode. The tests cover it (link-team).',
        ],
      );
    },
  },
  {
    id: 'S18',
    slug: 'email-admin',
    title: 'Email admin, no GitHub',
    async run(ctx) {
      const s = new Seed(ctx);
      await s.team(T.product);
      await s.member(T.product.repo, P.priya, P.sam.name, 15 * DAY, 'admin');
      await s.discovery(T.product, true);
      await s.request(T.product, P.taylor, 3 * 3_600_000);
      return result(
        [
          {
            ...P.priya,
            kind: 'teams',
            teams: teamsOf([T.product, 'admin']),
            expect: 'Admin without GitHub: the home shows Taylor asking to join (Approve works). Settings > Members: invite by email, make Leo admin, remove him. Reviewer stays greyed with the reason.',
          },
          { ...P.leo, kind: 'teams', teams: teamsOf([T.product, 'edit']), expect: 'Can edit: reads Members, changes nothing.' },
        ],
        ['Priya is an email admin (role admin on her membership), not a seeded local admin: the real production path.'],
      );
    },
  },
];

/** The scenario for a name: "S3", "s3", "3" or its slug ("domain-one"). */
export function findScenario(name: string): Scenario | null {
  const n = name.trim().toLowerCase();
  return SCENARIOS.find((s) => s.id.toLowerCase() === n || s.id.slice(1) === n || s.slug === n || `${s.id}-${s.slug}`.toLowerCase() === n) ?? null;
}

/** What `npm run dev:scenario <name>` prints. */
export function describeResult(s: Scenario, r: ScenarioResult, origin: string): string {
  const lines = [`${s.id} ${s.title}`, '', 'Sign in (any code from /api/dev/outbox):'];
  for (const x of r.signIns) {
    const teams = x.teams ? ` [${Object.entries(x.teams).map(([repo, role]) => `${repo} ${role}`).join(', ')}]` : '';
    lines.push(`  ${x.email.padEnd(22)} ${x.name.padEnd(15)} /api/entry: ${x.kind}${teams}`, `      ${x.expect}`);
  }
  if (r.links.length) {
    lines.push('', 'Links:');
    for (const l of r.links) lines.push(`  ${l.url}`, `      ${l.expect}`);
  }
  if (r.notes.length) lines.push('', ...r.notes);
  lines.push('', `Open ${origin}/signin/ ; codes at ${origin}/api/dev/outbox`);
  return lines.join('\n');
}
