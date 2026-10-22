// Settings > Review rules: which changes need which approvals, as one small DS Table in plain words (no tier numbers,
// from docs/GOVERNANCE.md through approvalRules). The owner override stays a rule of bridge.config.json and of the
// merge flow; Settings does not show it, since designers never act on it.
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@bridge-ds/react';

export interface ChangeRulesProps {
  rules: { what: string; who: string }[];
}

export default function ChangeRules({ rules }: ChangeRulesProps) {
  return (
    <div className="set-change-rules">
      <Table aria-label="Approvals each kind of branch needs">
        <TableHeader>
          <TableRow>
            <TableHead width={0.35}>Kind of branch</TableHead>
            <TableHead>Needs</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rules.map((r) => (
            <TableRow key={r.what}>
              <TableCell role="rowheader">{r.what}</TableCell>
              <TableCell>{r.who}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
