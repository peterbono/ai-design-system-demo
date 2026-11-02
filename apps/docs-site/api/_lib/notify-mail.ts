// The notification emails (api/_lib/notify.ts): one sentence, one button to the exact Studio page, a footer to change
// what Bridge emails you and a one-click unsubscribe (List-Unsubscribe + List-Unsubscribe-Post, RFC 8058). Plain text
// and simple HTML, light on brand (the Bridge name in Deep Harbor, one button), no image. Bridge voice: no em dash,
// no "issue", "pull request", "repository", "merge", "check" or "webhook": a designer reads it.
//
// The unsubscribe token is sealed (AES-256-GCM under LIBRARY_SESSION_SECRET, purpose notify-unsubscribe, sealed.ts):
// signed, so nobody can make one, and opaque, so the address never sits in a link or a request log.

import { escHtml, type EmailMessage } from './email.js';
import { b64url, fromB64url } from './http.js';
import type { NotifyKind } from './notify-events.js';
import { NEEDS_KINDS } from './notify-events.js';
import { seal, sealingKey, unseal } from './sealed.js';

/** One thing that happened, as kept for an email: names only, never an email or a comment body. */
export interface NotifyItem {
  /** Unique per delivery and notice. */
  id: string;
  kind: NotifyKind;
  /** The task or suggestion, in the designer's words. */
  title: string;
  /** Who did it: their Bridge name, else their GitHub login. */
  actor: string;
  /** The team's name as Bridge shows it, and its key (owner/name). */
  team: string;
  teamRepo: string;
  /** The exact Studio page, absolute. */
  href: string;
  at: number;
}

/** The lines of one notice: the subject, the sentence, the button. */
export function linesOf(i: Pick<NotifyItem, 'kind' | 'title' | 'actor'>): { subject: string; sentence: string; button: string } {
  const { title, actor } = i;
  switch (i.kind) {
    case 'question':
      return { subject: `${actor} has a question about ${title}`, sentence: `${actor} asked something about your exploration and is waiting for your answer.`, button: `Answer ${actor}` };
    case 'look':
      return { subject: `${title} is ready for your look`, sentence: `${actor} built ${title} and would like you to check it matches your design.`, button: 'Look at it' };
    case 'changes':
      return { subject: `${actor} asked for changes on ${title}`, sentence: `${actor} left a few notes on your library suggestion. Send a new version when you are ready.`, button: `See ${actor}'s notes` };
    case 'declined':
      return { subject: `${title} will not be built for now`, sentence: `${actor} decided not to build it this time and left a note.`, button: 'Read the note' };
    case 'shipped':
      return { subject: `${title} shipped`, sentence: 'What you designed is now in the product. Nice work.', button: 'See it' };
    case 'suggestion-declined':
      return { subject: `${actor} closed ${title}`, sentence: `${actor} decided not to add it to the library this time and said why.`, button: 'Read why' };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Unsubscribe

/** What a one-click unsubscribe stops: the "needs you" emails, the daily summary, or both. */
export type UnsubKind = 'needs' | 'news' | 'all';
const UNSUB_KINDS: readonly UnsubKind[] = ['needs', 'news', 'all'];
const PURPOSE = 'notify-unsubscribe';
const BOUND = 'unsub';

/** The sealed token of an unsubscribe link, or null when the session secret is missing. */
export function unsubToken(secret: string, email: string, kind: UnsubKind, random?: (n: number) => Uint8Array): string | null {
  const key = sealingKey(secret, PURPOSE);
  if (!key) return null;
  const s = seal(JSON.stringify({ e: email.trim().toLowerCase(), k: kind }), key, BOUND, random);
  return [s.iv, s.tag, s.ct].map((x) => b64url(Buffer.from(x, 'base64'))).join('.');
}

/** Who and what an unsubscribe token says, or null (made elsewhere, tampered, another secret). */
export function readUnsubToken(secret: string, token: unknown): { email: string; kind: UnsubKind } | null {
  if (typeof token !== 'string' || token.length > 600 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return null;
  const key = sealingKey(secret, PURPOSE);
  if (!key) return null;
  const [iv, tag, ct] = token.split('.').map((x) => fromB64url(x).toString('base64'));
  const text = unseal({ iv: iv!, tag: tag!, ct: ct! }, key, BOUND);
  if (!text) return null;
  try {
    const v = JSON.parse(text) as { e?: unknown; k?: unknown };
    return typeof v.e === 'string' && v.e.includes('@') && UNSUB_KINDS.includes(v.k as UnsubKind) ? { email: v.e, kind: v.k as UnsubKind } : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Layout

export interface MailLinks {
  to: string;
  /** Account > Email in Studio (the Account dialog opens on #account). */
  settings: string;
  /** The one-click unsubscribe address (GET shows a confirm page, POST unsubscribes). */
  unsubscribe: string;
}

const HARBOR = '#0B4A8B';
const INK = '#1A2433';
const MUTED = '#4A5568';

/** The teams named in a footer: "Acme", "Acme and Shop", "Acme, Shop and Ops". */
export function teamsInWords(teams: readonly string[]): string {
  const t = [...new Set(teams)];
  if (t.length <= 1) return t[0] ?? 'your team';
  return `${t.slice(0, -1).join(', ')} and ${t[t.length - 1]}`;
}

function page(subject: string, inner: string, teams: readonly string[], l: MailLinks): string {
  return [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escHtml(subject)}</title></head>`,
    `<body style="margin:0;padding:24px 16px;background:#F5F7FA;color:${INK};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.5">`,
    '<div style="max-width:520px;margin:0 auto;background:#FFFFFF;border-radius:12px;padding:24px">',
    `<p style="margin:0 0 16px;font-family:Georgia,'Times New Roman',serif;font-size:18px;font-weight:600;color:${HARBOR}">Bridge</p>`,
    inner,
    `<p style="margin:24px 0 0;font-size:13px;color:${MUTED}">You get this because you are on ${escHtml(teamsInWords(teams))}. <a href="${escHtml(l.settings)}" style="color:${HARBOR}">Change what Bridge emails you</a> or <a href="${escHtml(l.unsubscribe)}" style="color:${HARBOR}">stop these emails</a>.</p>`,
    '</div></body></html>',
  ].join('\n');
}

const button = (href: string, label: string) =>
  `<p style="margin:20px 0 0"><a href="${escHtml(href)}" style="display:inline-block;background:${HARBOR};color:#FFFFFF;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">${escHtml(label)}</a></p>`;

const footerText = (teams: readonly string[], l: MailLinks) => [`You get this because you are on ${teamsInWords(teams)}.`, `Change what Bridge emails you: ${l.settings}`, `Stop these emails: ${l.unsubscribe}`];

const unsubHeaders = (l: MailLinks) => ({ 'List-Unsubscribe': `<${l.unsubscribe}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' });

/** One notice, sent right away: one sentence, one button. */
export function instantEmail(i: NotifyItem, l: MailLinks): EmailMessage {
  const { subject, sentence, button: label } = linesOf(i);
  const text = [sentence, '', `${label}: ${i.href}`, '', ...footerText([i.team], l)].join('\n');
  const html = page(subject, `<p style="margin:0">${escHtml(sentence)}</p>\n${button(i.href, label)}`, [i.team], l);
  return { to: l.to, subject, text, html, headers: unsubHeaders(l) };
}

const things = (n: number, verb: [string, string]) => `${n} ${n === 1 ? 'thing' : 'things'} ${n === 1 ? verb[0] : verb[1]}`;

/** The daily summary subject: "Today on Acme: 2 things need you, 3 things moved", or "3 things moved on Acme". */
export function digestSubject(team: string, needs: number, moved: number): string {
  const need = things(needs, ['needs you', 'need you']);
  const move = things(moved, ['moved', 'moved']);
  if (!needs) return `${move} on ${team}`;
  return moved ? `Today on ${team}: ${need}, ${move}` : `Today on ${team}: ${need}`;
}

/**
 * The daily summary: "Needs you" first, then "What moved", one line per thing, each a link to its page. Null when
 * there is nothing: a summary is never sent empty.
 */
export function digestEmail(items: readonly NotifyItem[], l: MailLinks & { home: string }): EmailMessage | null {
  if (!items.length) return null;
  const sorted = [...items].sort((a, b) => a.at - b.at);
  const needs = sorted.filter((i) => NEEDS_KINDS.has(i.kind));
  const moved = sorted.filter((i) => !NEEDS_KINDS.has(i.kind));
  const teams = [...new Set(sorted.map((i) => i.team))];
  const subject = digestSubject(teams.length === 1 ? teams[0]! : 'Bridge', needs.length, moved.length);
  const MAX = 20;
  const textGroup = (title: string, list: NotifyItem[]) => (list.length ? [title, ...list.slice(0, MAX).map((i) => `- ${linesOf(i).subject}: ${i.href}`), ...(list.length > MAX ? [`- And ${list.length - MAX} more in Bridge.`] : []), ''] : []);
  const htmlGroup = (title: string, list: NotifyItem[]) =>
    list.length
      ? [
          `<h2 style="margin:20px 0 8px;font-size:15px;color:${INK}">${escHtml(title)}</h2>`,
          '<ul style="margin:0;padding-left:20px">',
          ...list.slice(0, MAX).map((i) => `<li style="margin:4px 0"><a href="${escHtml(i.href)}" style="color:${HARBOR}">${escHtml(linesOf(i).subject)}</a></li>`),
          ...(list.length > MAX ? [`<li style="margin:4px 0">And ${list.length - MAX} more in Bridge.</li>`] : []),
          '</ul>',
        ].join('\n')
      : '';
  const text = [...textGroup('Needs you', needs), ...textGroup('What moved', moved), `Open Bridge: ${l.home}`, '', ...footerText(teams, l)].join('\n');
  const inner = [htmlGroup('Needs you', needs), htmlGroup('What moved', moved), button(l.home, 'Open Bridge')].filter(Boolean).join('\n');
  return { to: l.to, subject, text, html: page(subject, inner, teams, l), headers: unsubHeaders(l) };
}
