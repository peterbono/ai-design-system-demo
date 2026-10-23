// Work email domains (api/entry, team discovery). A free or public mailbox provider is never a company: nobody can
// find a team through it, and no admin can open their team to it. Kept in one place, lower case.

/** Exact domains of public mailbox providers. */
export const PUBLIC_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  // Google, Microsoft, Apple, Yahoo, AOL
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'passport.com',
  'icloud.com', 'me.com', 'mac.com', 'yahoo.com', 'ymail.com', 'rocketmail.com', 'aol.com', 'aim.com',
  // Privacy-first and independent
  'proton.me', 'protonmail.com', 'protonmail.ch', 'pm.me', 'tutanota.com', 'tutanota.de', 'tuta.io', 'tuta.com',
  'fastmail.com', 'fastmail.fm', 'hey.com', 'zoho.com', 'zohomail.com', 'mailbox.org', 'posteo.de', 'posteo.net',
  'duck.com', 'hushmail.com', 'runbox.com', 'disroot.org', 'riseup.net', 'startmail.com', 'skiff.com',
  // GMX, Web.de, United Internet, Germany
  'gmx.com', 'gmx.net', 'gmx.de', 'gmx.fr', 'gmx.at', 'gmx.ch', 'web.de', 'mail.com', 't-online.de', 'freenet.de', 'arcor.de',
  // Russia and nearby
  'yandex.com', 'yandex.ru', 'ya.ru', 'mail.ru', 'inbox.ru', 'list.ru', 'bk.ru', 'rambler.ru', 'ukr.net',
  // France
  'orange.fr', 'wanadoo.fr', 'free.fr', 'laposte.net', 'sfr.fr', 'neuf.fr', 'bbox.fr', 'numericable.fr', 'aliceadsl.fr', 'club-internet.fr', 'noos.fr', 'voila.fr',
  // Italy, Spain, Benelux, Nordics, Poland, Czechia
  'libero.it', 'virgilio.it', 'tiscali.it', 'alice.it', 'tim.it', 'email.it', 'telefonica.net', 'terra.es',
  'skynet.be', 'telenet.be', 'ziggo.nl', 'kpnmail.nl', 'planet.nl', 'home.nl', 'online.no', 'telia.com',
  'wp.pl', 'o2.pl', 'onet.pl', 'interia.pl', 'seznam.cz', 'centrum.cz',
  // UK, North America, Oceania
  'btinternet.com', 'sky.com', 'virginmedia.com', 'ntlworld.com', 'talktalk.net', 'blueyonder.co.uk',
  'comcast.net', 'verizon.net', 'att.net', 'sbcglobal.net', 'bellsouth.net', 'cox.net', 'charter.net', 'earthlink.net', 'juno.com',
  'shaw.ca', 'rogers.com', 'sympatico.ca', 'bigpond.com', 'optusnet.com.au', 'xtra.co.nz',
  // Asia and Latin America
  'qq.com', '163.com', '126.com', 'sina.com', 'sohu.com', 'aliyun.com', 'naver.com', 'daum.net', 'hanmail.net',
  'rediffmail.com', 'uol.com.br', 'bol.com.br', 'terra.com.br',
  // Disposable addresses
  'mailinator.com', 'guerrillamail.com', 'sharklasers.com', '10minutemail.com', 'temp-mail.org', 'yopmail.com', 'yopmail.fr', 'trashmail.com', 'getnada.com',
]);

/**
 * Providers that run the same mailbox under many country domains: yahoo.fr, hotmail.co.uk, outlook.de, live.fr. A
 * domain whose first label is one of these, followed by a country or generic suffix only, is public.
 */
const PUBLIC_BRANDS = new Set(['gmail', 'googlemail', 'yahoo', 'ymail', 'hotmail', 'outlook', 'live', 'msn', 'windowslive', 'aol', 'gmx', 'yandex', 'icloud', 'protonmail', 'proton', 'zoho', 'mail', 'email', 'yopmail']);
const SUFFIX = /^(?:[a-z]{2,3}|co\.[a-z]{2}|com\.[a-z]{2}|ne\.[a-z]{2}|or\.[a-z]{2})$/;
const DOMAIN = /^(?=.{3,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** The domain part of an email, lower case, or null. */
export function domainOf(email: string): string | null {
  const at = email.lastIndexOf('@');
  if (at < 1) return null;
  const d = email.slice(at + 1).trim().toLowerCase().replace(/\.$/, '');
  return DOMAIN.test(d) ? d : null;
}

/** True for a public or free mailbox domain (exact, a subdomain of one, or a provider under another country domain). */
export function isPublicDomain(domain: string): boolean {
  const d = domain.trim().toLowerCase().replace(/\.$/, '');
  if (!DOMAIN.test(d)) return true;
  const labels = d.split('.');
  // mail.yahoo.com, eu.gmx.net: a subdomain of a public provider is public too.
  for (let i = 0; i < labels.length - 1; i++) if (PUBLIC_EMAIL_DOMAINS.has(labels.slice(i).join('.'))) return true;
  return PUBLIC_BRANDS.has(labels[0]!) && SUFFIX.test(labels.slice(1).join('.'));
}

/** The work domain of an email: its domain when it is not a public mailbox provider, else null. */
export function workDomain(email: string): string | null {
  const d = domainOf(email);
  return d && !isPublicDomain(d) ? d : null;
}
