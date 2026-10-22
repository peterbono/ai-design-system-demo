// Email through Resend, shared by the /api functions that send links (invites, library sign-in, contributor sign-in).

import type { FetchLike } from './http.js';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
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

export const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
