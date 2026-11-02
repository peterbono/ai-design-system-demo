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
      if (!res.ok) throw new Error(`email provider answered ${res.status}`);
    },
  };
}

export const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
