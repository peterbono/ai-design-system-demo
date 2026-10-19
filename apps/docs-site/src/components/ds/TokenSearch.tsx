// The token filter of the explorer (Library Tokens and Studio Tokens): a DS Input with a search glyph and, in the
// Library, the F shortcut hint. Static; scripts/explorer/index.ts reads it ([data-xp-q]) and focuses it on F.
import { Icon, Input, Kbd } from '@bridge-ds/react';
import { Search } from 'lucide-react';

export interface TokenSearchProps {
  /** Studio says less: the toolbar is tighter there. */
  surface: 'app' | 'library';
}

export default function TokenSearch({ surface }: TokenSearchProps) {
  const app = surface === 'app';
  return (
    <Input
      id="xp-q"
      className="xp-search-field"
      size="sm"
      type="search"
      placeholder={app ? 'Filter tokens' : 'Name, CSS variable or hex'}
      aria-label={app ? 'Filter tokens by name, CSS variable or hex' : 'Search tokens'}
      aria-keyshortcuts="F"
      autoComplete="off"
      spellCheck={false}
      data-xp-q=""
      prefix={<Icon icon={Search} size="sm" />}
      suffix={app ? undefined : <Kbd keys="F" size="sm" className="xp-slash" aria-hidden="true" />}
    />
  );
}
