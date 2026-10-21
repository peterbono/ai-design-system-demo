// The filter field of Studio Components: a DS Input with a search glyph. Static; scripts/components-studio.ts reads it.
// Size md, like the family Select beside it and every page-level filter bar (Library tokens, Studio tokens).
import { Icon, Input } from '@bridge-ds/react';
import { Search } from 'lucide-react';

export default function ComponentsSearch() {
  return <Input className="cm-search" size="md" type="search" placeholder="Filter components" aria-label="Filter components" prefix={<Icon icon={Search} size="sm" />} data-cm-q="" autoComplete="off" />;
}
