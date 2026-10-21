// Titles of request and suggestion issues: "<Subject>: <what changes>", the subject being a component name or a kind
// ("Tokens"). One rule for requests (requests.ts), suggestions (suggestions.ts) and Studio, so a title is never
// prefixed twice ("Select: select: ...") and a component name keeps its capitals ("EmptyState", not "emptyState").

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Whether a word is a proper name to keep as written: a component name the caller knows, or a word with a capital
 * after its first letter (PascalCase "EmptyState", "DatePicker", an acronym "WCAG").
 */
function properWord(word: string, names: readonly string[]): boolean {
  const bare = word.replace(/[^\p{L}\p{N}]+$/u, '');
  if (!bare) return false;
  if (names.some((n) => n === bare)) return true;
  return /\p{Lu}/u.test(bare.slice(1));
}

/** The first letter in lower case, unless the first word is a proper name (properWord). */
export function lowerFirstWord(text: string, names: readonly string[] = []): string {
  const first = text.split(/\s+/)[0] ?? '';
  if (!first || properWord(first, names)) return text;
  return `${text.charAt(0).toLowerCase()}${text.slice(1)}`;
}

/**
 * "<subject>: <title>", the title's first letter lowered unless it starts with a proper name. A title that already
 * starts with the subject (any case, with or without a colon) is not prefixed again: "select: keyboard focus" under
 * Select gives "Select: keyboard focus", "Select keeps focus" stays "Select keeps focus", with the subject's own
 * capitals. A trailing period is dropped. `names` lists other proper names to keep (component names).
 */
export function subjectTitle(subject: string, title: string, names: readonly string[] = []): string {
  const t = title.trim().replace(/\.$/, '');
  const keep = [subject, ...names];
  const s = subject.trim();
  if (!s) return t;
  const m = new RegExp(`^${escape(s)}(?=$|[^\\p{L}\\p{N}])\\s*(:)?\\s*`, 'iu').exec(t);
  if (m) {
    const rest = t.slice(m[0].length);
    if (!rest) return s;
    // "Select: keyboard focus": the colon form keeps the colon; "Select keeps focus" reads as a sentence.
    return m[1] ? `${s}: ${lowerFirstWord(rest, keep)}` : `${s} ${rest}`;
  }
  return `${s}: ${lowerFirstWord(t, keep)}`;
}
