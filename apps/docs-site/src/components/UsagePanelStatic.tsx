// The Usage tab of a Library component page, rendered at build time (examples with every Lucide icon).
import Example from './Example';
import UsagePanel from './UsagePanel';
import type { ComponentDocs } from '../lib/components';

export default function UsagePanelStatic({ docs }: { docs: ComponentDocs }) {
  return <UsagePanel docs={docs} Example={Example} />;
}
