import type { Meta, StoryObj } from '@storybook/react-vite';
import { Specimen, SpecimenStack } from '../../stories/StateGrid';
import { Button } from '../Button';
import { Checklist, ChecklistRow, type ChecklistStatus } from './Checklist';

/** A 390px phone viewport, so the media queries see a narrow screen (a narrow wrapper would not). */
const phone = {
  parameters: { viewport: { options: { phone390: { name: 'Phone 390', styles: { width: '390px', height: '844px' }, type: 'mobile' } } } },
  globals: { viewport: { value: 'phone390', isRotated: false } },
};

const meta = {
  title: 'Data display/Checklist',
  component: Checklist,
  args: { label: 'What it needs to ship' },
  argTypes: { footer: { control: false }, children: { control: false } },
  decorators: [(Story) => <div style={{ maxWidth: 720 }}><Story /></div>],
} satisfies Meta<typeof Checklist>;

export default meta;
type Story = StoryObj<typeof meta>;

function ShipChecklist({ approve = true }: { approve?: boolean }) {
  return (
    <Checklist label="What it needs to ship">
      <ChecklistRow status="done" title="Design rules" detail="All 14 rules pass: contrast, naming, aliases." />
      <ChecklistRow status="done" title="Developer tests" detail="212 tests pass on the preview build." />
      <ChecklistRow
        status="waiting"
        title="Design approval"
        detail="Waiting on a design owner."
        action={approve ? <Button size="sm" variant="secondary">Approve</Button> : undefined}
      />
    </Checklist>
  );
}

export const Default: Story = { render: () => <ShipChecklist /> };

export const Blocked: Story = {
  render: () => (
    <Checklist
      label="What it needs to ship"
      footer={
        <>
          <p>This change waits on a failing test. Fix it on the branch, or ask a developer to look.</p>
          <div>
            <Button size="sm" variant="secondary">Open the test report</Button>
          </div>
        </>
      }
    >
      <ChecklistRow status="done" title="Design rules" detail="All 14 rules pass." />
      <ChecklistRow status="failed" title="Developer tests" detail="2 of 212 tests fail: Button focus ring, Select keyboard." action={<Button size="sm" variant="secondary">View tests</Button>} />
      <ChecklistRow status="warning" title="Design approval" detail="Approved before the last change. Ask again." action={<Button size="sm" variant="secondary">Ask again</Button>} />
    </Checklist>
  ),
};

export const ReadyToShip: Story = {
  render: () => (
    <Checklist label="What it needs to ship">
      <ChecklistRow status="done" title="Design rules" detail="All 14 rules pass." />
      <ChecklistRow status="done" title="Developer tests" detail="212 tests pass." />
      <ChecklistRow status="done" title="Design approval" detail="Approved by Lea Martin." />
    </Checklist>
  ),
};

/** Narrow: the detail goes under the title and the Approve button takes the full width of the row. */
export const NarrowWithAction: Story = { ...phone, render: () => <ShipChecklist /> };

const STATUSES: { status: ChecklistStatus; title: string; detail: string }[] = [
  { status: 'done', title: 'Design rules', detail: 'All 14 rules pass.' },
  { status: 'failed', title: 'Developer tests', detail: '2 of 212 tests fail.' },
  { status: 'warning', title: 'Contrast', detail: 'color.text.muted is 4.3:1 on color.bg.subtle.' },
  { status: 'waiting', title: 'Design approval', detail: 'Waiting on a design owner.' },
];

export const AllStates: Story = {
  render: () => (
    <SpecimenStack>
      <Specimen label="Statuses (done, failed, warning, waiting)">
        <div style={{ width: '100%' }}>
          <Checklist label="Statuses">
            {STATUSES.map((s) => (
              <ChecklistRow key={s.status} {...s} />
            ))}
          </Checklist>
        </div>
      </Specimen>
      <Specimen label="Row with an action (hover and focus come from Button)">
        <div style={{ width: '100%' }}>
          <ShipChecklist />
        </div>
      </Specimen>
      <Specimen label="Footer with an action">
        <div style={{ width: '100%' }}>
          <Checklist
            label="What it needs to ship"
            footer={
              <>
                <p>Design approval waits on a design owner. Anyone with the design role can approve.</p>
                <div>
                  <Button size="sm" variant="secondary">Request a review</Button>
                </div>
              </>
            }
          >
            <ChecklistRow status="done" title="Developer tests" detail="212 tests pass." />
            <ChecklistRow status="waiting" title="Design approval" detail="Waiting on a design owner." />
          </Checklist>
        </div>
      </Specimen>
      <Specimen label="Long detail (wraps in its column)">
        <div style={{ width: '100%' }}>
          <Checklist label="Long detail">
            <ChecklistRow
              status="warning"
              title="Design rules"
              detail="color.feedback.warning.border.subtle has no dark value, and 3 components still read color.harbor.500 directly instead of a semantic token."
              action={<Button size="sm" variant="secondary">Review</Button>}
            />
          </Checklist>
        </div>
      </Specimen>
    </SpecimenStack>
  ),
};
