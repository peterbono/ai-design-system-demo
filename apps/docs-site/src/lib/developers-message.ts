// The message for the developers of a product added from its address (ProductConfig.address). Done exploring keeps
// the task in the design team's own code (Being built reads it there), but the real developers work elsewhere and never
// see it: once it is done exploring, team members copy one plain message and paste it where those developers work.
// The exploration page (the "Developers build it" step) and Being built (the exploration's row) offer the same copy.
// Pure: the words, the message and who sees the action. Unit tested in developers-message.test.ts.
import type { RepoAccessState } from '@bridge-ds/core';

export const DEV_MESSAGE_WORDS = {
  copy: 'Copy for your developers',
  copied: 'Message copied',
  said: 'Message copied. Paste it where your developers work.',
  elsewhere: 'Their developers work elsewhere: send them the message.',
} as const;

export interface DevelopersMessageInput {
  /** The exploration's name. */
  name: string;
  /** The product's name ("Poster Studio"). */
  product: string;
  /** The product's live address ("https://posterstudio.com"). */
  address: string;
  /** The live page the exploration started from, when it started from one. */
  startPage?: string | null;
  /** What changes, in the designer's words (the exploration's purpose). */
  purpose?: string | null;
  /** The exploration's preview, when it has one. */
  previewUrl?: string | null;
  /** The captured screenshot of the preview, when Bridge kept one. */
  shotUrl?: string | null;
}

/** An https link with nothing that could break a pasted line, else null. */
const link = (v: string | null | undefined): string | null => {
  const s = v?.trim();
  return s && s.length <= 500 && /^https:\/\/[^\s<>"`]+$/.test(s) ? s : null;
};

/** One line of text: no line breaks, no em or en dashes, at most 300 characters. */
const plain = (v: string | null | undefined): string =>
  (v ?? '')
    .replace(/\s+/g, ' ')
    .replace(/\s*[\u2014\u2013]\s*/g, ', ')
    .trim()
    .slice(0, 300);

/**
 * The plain, self-contained message: what changes, the page today, the preview, the screenshot when there is one, and
 * how to read the preview. No GitHub, branch or code words: the developers may never have heard of Bridge.
 */
export function developersMessage(t: DevelopersMessageInput): string {
  const product = plain(t.product) || 'the product';
  const name = plain(t.name);
  const purpose = plain(t.purpose);
  const page = link(t.startPage) ?? link(t.address);
  const preview = link(t.previewUrl);
  const shot = link(t.shotUrl);
  return [
    purpose && name ? `A change to ${product} is ready to build: ${name}.` : `A change to ${product} is ready to build.`,
    '',
    `What changes: ${purpose || name}`,
    ...(page ? [`The page today: ${page}`] : []),
    ...(preview ? [`The preview: ${preview}`] : []),
    ...(shot ? [`A screenshot: ${shot}`] : []),
    '',
    preview
      ? `Open the preview next to the page today to see the change. It rebuilds the page with our design system, so take it as the picture of what to build in ${product}, not as code to copy.`
      : `The preview link follows as soon as it is ready. It rebuilds the page with our design system, so take it as the picture of what to build in ${product}, not as code to copy.`,
    '',
    'Ask me if anything is unclear.',
  ].join('\n');
}

/** GitHub access that makes someone part of the team: they can at least read its code. */
const TEAM_ACCESS: readonly RepoAccessState[] = ['reader', 'writer', 'admin'];

/**
 * Whether the viewer belongs to the team: a member who joined with their email, or someone signed in with GitHub who can
 * read the team's code. Never a signed-out visitor, nor a visitor of the sample team.
 */
export function teamMember(v: { emailMember: boolean; signedIn: boolean; access: RepoAccessState | null | undefined; sample?: boolean }): boolean {
  if (v.sample) return false;
  if (v.emailMember) return true;
  return v.signedIn && Boolean(v.access && TEAM_ACCESS.includes(v.access));
}

/**
 * Whether "Copy for your developers" shows: an exploration of a product added from its address, done exploring and
 * still waiting for its developers or being built (not shipped, not declined, not archived), for a team member.
 */
export function offersDevelopersMessage(x: {
  address: string | null | undefined;
  status: string;
  declined?: boolean;
  archived?: boolean;
  member: boolean;
}): boolean {
  if (!x.address || !x.member || x.declined || x.archived) return false;
  return x.status === 'ready' || x.status === 'building' || x.status === 'requested' || x.status === 'in-progress' || x.status === 'picked-up';
}
