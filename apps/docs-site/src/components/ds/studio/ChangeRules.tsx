// Settings > Review rules: which changes need which approvals, as one small DS Table in plain words (no tier numbers,
// from docs/GOVERNANCE.md through approvalRules), then the owner override folded in a flush DS Accordion under it.
import { Accordion, AccordionItem, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@bridge-ds/react';

export interface ChangeRulesProps {
  rules: { what: string; who: string }[];
  override: { on: boolean; text: string };
}

export default function ChangeRules({ rules, override }: ChangeRulesProps) {
  return (
    <div className="set-change-rules">
      <Table aria-label="Approvals each kind of change needs">
        <TableHeader>
          <TableRow>
            <TableHead width={0.35}>Change</TableHead>
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
      <Accordion appearance="flush" headingLevel={4}>
        <AccordionItem value="override" title={`Owner override: ${override.on ? 'on' : 'off'}`}>
          {override.text}
        </AccordionItem>
      </Accordion>
    </div>
  );
}
