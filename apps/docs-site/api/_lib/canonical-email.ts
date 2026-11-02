// One spelling per mailbox. Bridge keys everything it keeps for a person by email (accounts, memberships, invites,
// join requests, sign-in codes, notifications, contributor sessions, connections in Claude), so two spellings of one
// mailbox must never make two people. Gmail ignores dots and anything after a "+" in the part before the @, and
// googlemail.com is gmail.com: florian.gouloubi+bridge@googlemail.com and floriangouloubi@gmail.com reach the same
// inbox. Every other provider is only lower-cased here: dots and "+" can mean different mailboxes there.
//
// Keys use canonicalEmail. What the person typed stays what Bridge shows (an account keeps it as `displayEmail`).
// Data written before this rule may still sit under its old key (the address lower-cased, legacyEmail): readers try
// that spelling too, and api/_lib/account-merge.ts moves it to the canonical key the next time the person signs in.

const GMAIL_DOMAINS: ReadonlySet<string> = new Set(['gmail.com', 'googlemail.com']);

/** The address trimmed and lower-cased: how Bridge keyed emails before canonical keys. */
export const legacyEmail = (email: string): string => email.trim().toLowerCase();

/** True for a Gmail address (gmail.com or googlemail.com). */
export function isGmail(email: string): boolean {
  const e = legacyEmail(email);
  const at = e.lastIndexOf('@');
  return at > 0 && GMAIL_DOMAINS.has(e.slice(at + 1));
}

/**
 * The one spelling of a mailbox: lower case; for Gmail (gmail.com, googlemail.com) without the dots and the "+..." of
 * the part before the @, on gmail.com. Any other domain is only lower-cased. A string that is not an address comes
 * back trimmed and lower-cased.
 */
export function canonicalEmail(email: string): string {
  const e = legacyEmail(email);
  const at = e.lastIndexOf('@');
  if (at <= 0) return e;
  const domain = e.slice(at + 1);
  if (!GMAIL_DOMAINS.has(domain)) return e;
  const local = e.slice(0, at).split('+')[0]!.replace(/\./g, '');
  // "+tag@gmail.com" or ".@gmail.com" is no Gmail mailbox: kept as typed rather than keyed by an empty name.
  return local ? `${local}@gmail.com` : e;
}

/** True when both are the same mailbox (false when either is not a string or is empty). */
export function sameEmail(a: unknown, b: unknown): boolean {
  return typeof a === 'string' && typeof b === 'string' && a.trim() !== '' && canonicalEmail(a) === canonicalEmail(b);
}

/**
 * The spellings to read a key under, the one the caller holds first: [legacy, canonical] when they differ (data
 * written before canonical keys), else just the one.
 */
export function emailSpellings(email: string): string[] {
  const legacy = legacyEmail(email);
  const canonical = canonicalEmail(email);
  return legacy === canonical ? [canonical] : [legacy, canonical];
}
