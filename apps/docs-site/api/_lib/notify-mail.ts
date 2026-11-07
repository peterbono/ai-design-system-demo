// The notification emails (api/_lib/notify.ts): one sentence, one button to the exact Studio page, a footer to change
// what Bridge emails you and a one-click unsubscribe (List-Unsubscribe + List-Unsubscribe-Post, RFC 8058). Plain text
// and HTML in the shell every Bridge email shares (mailPage in email.ts: the Bridge name in Deep Harbor, one button,
// a preheader, dark mail apps), no image. Bridge voice: no em dash,
// no "issue", "pull request", "repository", "merge", "check" or "webhook": a designer reads it.
//
// The unsubscribe token is sealed (AES-256-GCM under LIBRARY_SESSION_SECRET, purpose notify-unsubscribe, sealed.ts):
// signed, so nobody can make one, and opaque, so the address never sits in a link or a request log.

import { escHtml, mailButton, mailH2, mailLink, mailP, mailPage, mailQuote, type EmailMessage } from './email.js';
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
  /** What they wrote (notify-events quoteOf), for the right-away email only: never kept for the summary. */
  quote?: string;
}

/** The lines of one notice: the subject, the sentence, the button. */
export function linesOf(i: Pick<NotifyItem, 'kind' | 'title' | 'actor'>): { subject: string; sentence: string; button: string } {
  const { title, actor } = i;
  switch (i.kind) {
    case 'question':
      return { subject: `${actor} has a question about ${title}`, sentence: `${actor} asked something about ${title} and is waiting for your answer.`, button: `Answer ${actor}` };
    case 'look':
      return { subject: `${title} is ready for your look`, sentence: `${actor} built ${title} and would like you to check it matches your design.`, button: 'Look at it' };
    case 'changes':
      return { subject: `${actor} asked for changes on ${title}`, sentence: `${actor} left a few notes on ${title}, your library suggestion. Send a new version when you are ready.`, button: `See ${actor}'s notes` };
    case 'declined':
      return { subject: `${title} will not be built for now`, sentence: `${actor} decided not to build it this time and left a note.`, button: 'Read the note' };
    case 'shipped':
      return { subject: `${title} shipped`, sentence: 'What you designed is now in the product. Nice work.', button: 'See it' };
    case 'lead-ask':
      return { subject: `${actor} is done with ${title}`, sentence: `${actor} is done exploring ${title}. Nothing reaches the developers before you answer.`, button: 'Look at it' };
    case 'lead-answer':
      return { subject: `${actor} answered about ${title}`, sentence: `${actor} answered you about ${title}. It waits for your decision.`, button: 'Read it' };
    case 'lead-delegated':
      return { subject: `${actor} asks you to look at ${title}`, sentence: `${actor} would like you to review ${title} in their place.`, button: 'Look at it' };
    case 'lead-reminder':
      return { subject: `${title} waits for you since 2 days`, sentence: `${actor} is waiting for your answer on ${title}. Nothing reaches the developers before you answer.`, button: 'Look at it' };
    case 'lead-question':
      return { subject: `${actor} has a question about ${title}`, sentence: `${actor} asked something about ${title} and is waiting for your answer.`, button: 'Answer' };
    case 'lead-changes':
      return { subject: `${actor} asked for changes on ${title}`, sentence: `${actor} left a note on your exploration. It waits for your answer.`, button: 'Read the note' };
    case 'lead-took-back':
      return { subject: `${actor} took ${title} back`, sentence: `${actor} took ${title} back from the developers and said why.`, button: 'Read why' };
    case 'lead-not-doing':
      return { subject: `${title} will not be done`, sentence: `${actor} decided not to do ${title} and said why. Your work stays in Bridge.`, button: 'Read why' };
    case 'lead-handed':
      return { subject: `${actor} handed ${title} to you`, sentence: `${actor} handed ${title} over to you and said why. You carry it on from here.`, button: 'Open it' };
    case 'lead-ok':
      return { subject: `${title} went to the developers`, sentence: `${actor} said it looks right, so ${title} went to the developers.`, button: 'See it' };
    case 'lead-pm-ok':
      return { subject: `${actor} likes ${title}`, sentence: `${actor}, the product manager, said ${title} looks good.`, button: 'See it' };
    case 'lead-pm-changes':
      return { subject: `${actor} asked for changes on ${title}`, sentence: `${actor}, the product manager, left a note on your exploration.`, button: 'Read the note' };
    case 'lead-pm-call':
      return { subject: `${actor} says you agreed on ${title}`, sentence: `${actor} wrote that you agreed on ${title} in a call. If that is not right, give your own answer on the page.`, button: 'Open it' };
    case 'lead-build-changes':
      return { subject: `${actor} asked for changes on the build of ${title}`, sentence: `${actor} checked what the developers built for ${title} and left a note.`, button: 'Read the note' };
    case 'lead-build-ready':
      return { subject: `${title} is built: check it`, sentence: `The developers finished ${title}. Compare it with what was approved, then say if it can ship.`, button: 'Check the build' };
    case 'lead-shipped':
      return { subject: `${title} shipped`, sentence: `${title} is now in the product.`, button: 'See it' };
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

/** The teams named in a footer: "Acme", "Acme and Shop", "Acme, Shop and Ops". */
export function teamsInWords(teams: readonly string[]): string {
  const t = [...new Set(teams)];
  if (t.length <= 1) return t[0] ?? 'your team';
  return `${t.slice(0, -1).join(', ')} and ${t[t.length - 1]}`;
}

const footerHtml = (teams: readonly string[], l: MailLinks) =>
  `You get this because you are on ${escHtml(teamsInWords(teams))}. ${mailLink(l.settings, 'Change what Bridge emails you')} or ${mailLink(l.unsubscribe, 'stop these emails')}.`;

const footerText = (teams: readonly string[], l: MailLinks) => [`You get this because you are on ${teamsInWords(teams)}.`, `Change what Bridge emails you: ${l.settings}`, `Stop these emails: ${l.unsubscribe}`];

const unsubHeaders = (l: MailLinks) => ({ 'List-Unsubscribe': `<${l.unsubscribe}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' });

/** One notice, sent right away: one sentence, one button. */
export function instantEmail(i: NotifyItem, l: MailLinks): EmailMessage {
  const { subject, sentence, button: label } = linesOf(i);
  // What they wrote, quoted, so the designer understands without opening Bridge; the button takes them there to answer.
  const quote = i.quote?.trim() ?? '';
  const text = [sentence, ...(quote ? ['', ...quote.split('\n').map((x) => `> ${x}`.trimEnd())] : []), '', `${label}: ${i.href}`, '', ...footerText([i.team], l)].join('\n');
  const body = [mailP(escHtml(sentence), true), ...(quote ? [mailQuote(quote)] : []), mailButton(i.href, label)].join('\n');
  const html = mailPage({ subject, preheader: quote ? `"${quote.replace(/\s+/g, ' ').slice(0, 120)}"` : sentence, body, footer: footerHtml([i.team], l) });
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
  const htmlGroup = (title: string, list: NotifyItem[], first: boolean) =>
    list.length
      ? [
          mailH2(title, first),
          '<ul style="margin:0;padding-left:20px">',
          ...list.slice(0, MAX).map((i) => `<li style="margin:0 0 8px">${mailLink(i.href, linesOf(i).subject)}</li>`),
          ...(list.length > MAX ? [`<li style="margin:0 0 8px">And ${list.length - MAX} more in Bridge.</li>`] : []),
          '</ul>',
        ].join('\n')
      : '';
  const text = [...textGroup('Needs you', needs), ...textGroup('What moved', moved), `Open Bridge: ${l.home}`, '', ...footerText(teams, l)].join('\n');
  const inner = [htmlGroup('Needs you', needs, true), htmlGroup('What moved', moved, !needs.length), mailButton(l.home, 'Open Bridge')].filter(Boolean).join('\n');
  const preheader = needs.length ? needs.map((i) => linesOf(i).subject).join('. ') : moved.map((i) => linesOf(i).subject).join('. ');
  return { to: l.to, subject, text, html: mailPage({ subject, preheader, body: inner, footer: footerHtml(teams, l) }), headers: unsubHeaders(l) };
}
