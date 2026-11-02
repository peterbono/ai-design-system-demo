// Email providers, shared by the /api functions. Resend sends the access emails (sign-in codes and links, invites,
// join requests); Brevo sends the work notifications (api/_lib/notify.ts), so a busy day of notifications never
// spends the sign-in quota. Plain fetch, no SDK.

import type { FetchLike } from './http.js';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Extra headers (List-Unsubscribe and List-Unsubscribe-Post on notifications). Only brevoSender sends them. */
  headers?: Record<string, string>;
}

/** Sends one email; throws when the provider refuses it. */
export interface EmailSender {
  send(msg: EmailMessage): Promise<void>;
}

export function resendSender(apiKey: string, from: string, f: FetchLike): EmailSender {
  return {
    async send(msg) {
      let res: Response;
      try {
        res = await f('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html }),
        });
      } catch {
        throw new Error('email provider unreachable');
      }
      if (!res.ok) throw new Error(`email provider answered ${res.status}`);
    },
  };
}

/** "Bridge <notifications@acme.com>" or a bare address, as { name, email }; null when it holds no address. */
export function parseSender(from: string): { name: string; email: string } | null {
  const named = /^\s*"?([^"<]*?)"?\s*<([^<>\s@]+@[^<>\s@]+\.[^<>\s@]+)>\s*$/.exec(from);
  if (named) return { name: named[1]!.trim() || 'Bridge', email: named[2]! };
  const bare = /^\s*([^<>\s@]+@[^<>\s@]+\.[^<>\s@]+)\s*$/.exec(from);
  return bare ? { name: 'Bridge', email: bare[1]! } : null;
}

/**
 * Brevo's transactional API (v3, POST /v3/smtp/email, header api-key): the notification emails, with their
 * unsubscribe headers. Throws when Brevo refuses, never with the address or the key in the message.
 */
export function brevoSender(apiKey: string, from: string, f: FetchLike): EmailSender {
  const sender = parseSender(from);
  return {
    async send(msg) {
      if (!sender) throw new Error('the notification sender address is not valid');
      let res: Response;
      try {
        res = await f('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: { 'api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            sender,
            to: [{ email: msg.to }],
            subject: msg.subject,
            textContent: msg.text,
            htmlContent: msg.html,
            ...(msg.headers && Object.keys(msg.headers).length ? { headers: msg.headers } : {}),
          }),
        });
      } catch {
        throw new Error('email provider unreachable');
      }
      if (!res.ok) {
        // Brevo's error code ("unauthorized", "invalid_parameter"...) says why, never the address or the key.
        const code = await res
          .json()
          .then((b: { code?: unknown }) => (typeof b?.code === 'string' && /^[a-z_]{1,40}$/.test(b.code) ? ` ${b.code}` : ''))
          .catch(() => '');
        throw new Error(`email provider answered ${res.status}${code}`);
      }
    },
  };
}

export const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// ---------------------------------------------------------------------------------------------------------------
// Layout: one shell for every Bridge email (sign-in codes, invites, join requests, notifications)
//
// Email clients ignore stylesheets and CSS variables, so the Bridge palette is written out here as hex, from the
// tokens (docs/DESIGN-LANGUAGE.md): ink.900 text, ink.600 muted, ink.200 line, ink.50 canvas, harbor.700 (Deep
// Harbor) for the name, links and the one button. Dark mail apps (Apple Mail, Outlook.com) get the dark theme's
// values: ink.950 canvas, ink.900 card, ink.50 text, ink.400 muted, harbor.300 actions with harbor.950 text on them.
// Tables with role="presentation" lay it out (Outlook ignores max-width on a div); the button is a table cell with
// its own background, so it stays a button where padding on a link is dropped.

const MAIL = {
  ink: '#15202B',
  muted: '#5B6672',
  line: '#E3E8EE',
  canvas: '#F5F7F9',
  paper: '#FFFFFF',
  harbor: '#0B4A8B',
  font: "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif",
  display: "Georgia,'Times New Roman',serif",
  mono: "'IBM Plex Mono',SFMono-Regular,Menlo,Consolas,monospace",
} as const;

const DARK = [
  '.b-canvas{background:#0B1825 !important}',
  '.b-card{background:#15202B !important}',
  '.b-text{color:#F5F7F9 !important}',
  '.b-muted{color:#A0AAB5 !important}',
  '.b-link,.b-brand{color:#AAD2FE !important}',
  '.b-rule{border-color:#323E4C !important}',
  '.b-quote{background:#0B1825 !important;border-color:#323E4C !important}',
  '.b-btn{background:#AAD2FE !important}',
  '.b-btn a{color:#001732 !important}',
].join('');

const STYLE = [
  ':root{color-scheme:light dark;supported-color-schemes:light dark}',
  `@media (prefers-color-scheme: dark){${DARK}}`,
  // Outlook.com marks its dark mode with data-ogsc / data-ogsb instead of the media query.
  DARK.replace(/(^|\}|,)\./g, '$1[data-ogsc] .'),
  // Phones: the one button fills the width, an easy target.
  '@media (max-width:480px){.b-pad{padding:16px 8px !important}.b-inner{padding:20px !important}.b-btn-t{width:100% !important}.b-btn a{display:block !important;text-align:center !important}}',
].join('\n');

/** A link in an email body, in Deep Harbor (harbor.300 in dark mail apps). */
export const mailLink = (href: string, label: string) => `<a href="${escHtml(href)}" class="b-link" style="color:${MAIL.harbor};text-decoration:underline">${escHtml(label)}</a>`;

/** The one button of an email: 44px tall, a table cell so Outlook keeps its shape, full width on a phone. */
export const mailButton = (href: string, label: string) =>
  [
    `<table role="presentation" class="b-btn-t" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 0;border-collapse:separate">`,
    `<tr><td class="b-btn" bgcolor="${MAIL.harbor}" style="background:${MAIL.harbor};border-radius:8px">`,
    `<a href="${escHtml(href)}" style="display:inline-block;padding:12px 20px;font-family:${MAIL.font};font-size:16px;line-height:20px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:8px">${escHtml(label)}</a>`,
    '</td></tr></table>',
  ].join('');

/** A paragraph of an email body. `html` is already escaped. */
export const mailP = (html: string, last = false) => `<p style="margin:${last ? '0' : '0 0 12px'}">${html}</p>`;

/** A section title inside an email (the daily summary's "Needs you"). */
export const mailH2 = (text: string, first = false) => `<h2 style="margin:${first ? 0 : 24}px 0 8px;font-family:${MAIL.font};font-size:16px;line-height:24px;font-weight:600">${escHtml(text)}</h2>`;

/** What someone wrote, quoted under the sentence that says who: plain text, line breaks kept, escaped here. */
export const mailQuote = (text: string) =>
  `<blockquote class="b-quote" style="margin:16px 0 0;padding:12px 16px;background:${MAIL.canvas};border-left:4px solid ${MAIL.line};border-radius:0 8px 8px 0">${escHtml(text).replace(/\n/g, '<br>')}</blockquote>`;

/** A one-time sign-in code, large and spaced in Plex Mono so it reads digit by digit. */
export const mailCode = (code: string) =>
  `<p style="margin:16px 0;font-family:${MAIL.mono};font-size:28px;line-height:36px;letter-spacing:6px;font-weight:600">${escHtml(code)}</p>`;

/**
 * The page around an email: the Bridge name, the body, a footer under a line. `preheader` is the line inbox lists show
 * after the subject (hidden in the message); `footer` is already-escaped HTML in the muted, small style.
 */
export function mailPage(x: { subject: string; preheader: string; body: string; footer: string }): string {
  // Padding after the preheader keeps mail apps from pulling the body text into the preview.
  const pad = '&#847;&zwnj;&nbsp;'.repeat(40);
  return [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">',
    `<title>${escHtml(x.subject)}</title><style>${STYLE}</style></head>`,
    `<body class="b-canvas" style="margin:0;padding:0;background:${MAIL.canvas};-webkit-text-size-adjust:100%">`,
    `<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${MAIL.canvas}">${escHtml(x.preheader)}${pad}</div>`,
    `<table role="presentation" class="b-canvas" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${MAIL.canvas}">`,
    '<tr><td class="b-pad" align="center" style="padding:32px 16px">',
    `<table role="presentation" class="b-card" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background:${MAIL.paper};border-radius:12px">`,
    `<tr><td class="b-inner b-text" style="padding:32px;font-family:${MAIL.font};font-size:16px;line-height:24px;color:${MAIL.ink};text-align:left">`,
    `<p class="b-brand" style="margin:0 0 24px;font-family:${MAIL.display};font-size:20px;line-height:24px;font-weight:600;color:${MAIL.harbor}">Bridge</p>`,
    x.body,
    `<p class="b-muted b-rule" style="margin:32px 0 0;padding-top:16px;border-top:1px solid ${MAIL.line};font-size:13px;line-height:20px;color:${MAIL.muted}">${x.footer}</p>`,
    '</td></tr></table>',
    '</td></tr></table>',
    '</body></html>',
  ].join('\n');
}
