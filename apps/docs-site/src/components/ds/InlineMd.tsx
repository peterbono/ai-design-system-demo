// Inline Markdown (`code`, **bold**, [links](url)) as HTML in a span, through lib/markdown.ts inline(): the text is
// escaped first and link targets are allow-listed. For prose read from a repository's Markdown (docs/GOVERNANCE.md,
// AGENTS.md, docs/AI.md): Bridge's own at build time, a team's in the browser.
import { inline } from '../../lib/markdown';

export default function InlineMd({ md, className }: { md: string; className?: string }) {
  return <span className={className} dangerouslySetInnerHTML={{ __html: inline(md) }} />;
}
