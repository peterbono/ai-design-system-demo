// Who a pull request or issue is by, as Studio shows it. Bridge's GitHub app opens work for people (an email member,
// a designer writing through Bridge): GitHub then names the app ("bridge-design-studio[bot]") as its author, while
// the person is in the body, on the "Requested by … through Bridge." line or in the exploration block (memberName).
// Studio shows that person, never the app. Pure: tested in author.test.ts.
import { parseExplorationBody, requesterOf } from '@bridge-ds/core';
import { isBotLogin } from './people';

/** An app account ("bridge-design-studio[bot]", "app/bridge-design-studio"): it opens work, it is never the person. */
export const isAppLogin = (login: string | null | undefined): boolean => Boolean(login) && (isBotLogin(login!) || /^app\//i.test(login!.trim()));

/**
 * A person Bridge knows by name only, written where an author login goes: "name:Dino". GitHub logins never hold a
 * ":" (and "~" seeds are faces, lib/people nameFace), so it is never looked up on GitHub; its face is the name's.
 */
const NAME_PREFIX = 'name:';
export const nameAuthor = (name: string): string => `${NAME_PREFIX}${name.trim()}`;
export const isNameAuthor = (who: string | null | undefined): boolean => Boolean(who) && who!.startsWith(NAME_PREFIX) && who!.length > NAME_PREFIX.length;
export const nameOfAuthor = (who: string): string => who.slice(who.startsWith(NAME_PREFIX) ? NAME_PREFIX.length : 0);

/**
 * The author to show: the login GitHub gives, except for an app that opened it for someone: then that person, by
 * their GitHub login when the body names one ("Requested by Ann (@ann) through Bridge."), else by name ("name:Dino").
 * An app that opened it for nobody stays the app (automation, shown as such elsewhere).
 */
export function authorFor(login: string | null | undefined, body: string | null | undefined): string | null {
  if (!isAppLogin(login)) return login ?? null;
  const asked = requesterOf(body);
  if (asked?.login) return asked.login;
  const name = parseExplorationBody(body)?.memberName?.trim() || asked?.name?.trim();
  return name ? nameAuthor(name) : (login ?? null);
}

/**
 * Who started an exploration, as every screen names them (the Home card, the exploration page, Changes): the person its
 * record names, whoever's account opened its pull request. The "Requested by" line first (by login, else by name),
 * then the exploration block's author (a GitHub login, never an email address) and its member name; the account only
 * when nobody is named. Bridge can open a member's exploration with a lead's account, and a pull request opened again
 * by someone else (a repository moved to another organization) keeps the person who started it.
 */
export function explorationAuthorFor(login: string | null | undefined, body: string | null | undefined): string | null {
  const asked = requesterOf(body);
  if (asked?.login) return asked.login;
  const block = parseExplorationBody(body);
  const author = block?.author?.trim();
  if (author && !author.includes('@')) return author;
  const name = block?.memberName?.trim() || asked?.name?.trim();
  if (name) return nameAuthor(name);
  return authorFor(login, body);
}
