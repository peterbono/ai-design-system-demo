import type { Meta, StoryObj } from '@storybook/react-vite';
import { Specimen, SpecimenStack, StateGrid } from '../../stories/StateGrid';
import { Textarea } from './Textarea';

const meta = {
  title: 'Forms/Textarea',
  component: Textarea,
  args: { label: 'Change summary', hint: 'Reviewers read this first. Say what changed and why.', placeholder: 'Darkens steel 600 so muted text passes 4.5:1 on the canvas.' },
} satisfies Meta<typeof Textarea>;

export default meta;
type Story = StoryObj<typeof meta>;

const narrow: Story['decorators'] = [(S) => <div style={{ maxWidth: 420 }}><S /></div>];

export const Default: Story = { decorators: narrow };
export const WithCount: Story = { decorators: narrow, args: { maxLength: 280, showCount: true } };
export const Invalid: Story = { decorators: narrow, args: { error: 'Add a summary before you request review.' } };
export const Resizable: Story = { decorators: narrow, args: { autosize: false, rows: 4 } };

type Row = 'empty' | 'filled' | 'invalid' | 'disabled' | 'readonly';

export const AllStates: Story = {
  render: () => (
    <SpecimenStack>
      <StateGrid<Row>
        columns={[{ label: 'Default' }, { label: 'Hover', pseudo: 'hover' }, { label: 'Focus', pseudo: 'focus-visible' }]}
        rows={[
          { label: 'Empty', value: 'empty' },
          { label: 'Filled', value: 'filled' },
          { label: 'Invalid', value: 'invalid' },
          { label: 'Disabled', value: 'disabled' },
          { label: 'Read only', value: 'readonly' },
        ]}
        render={(row, col) => (
          <div style={{ width: 260 }}>
            <Textarea
              label={`Summary ${row} ${col.label}`}
              hideLabel
              rows={2}
              placeholder="What changed and why"
              defaultValue={row === 'empty' ? undefined : 'Darkens steel 600 so muted text passes on the canvas.'}
              error={row === 'invalid' ? 'Keep it under 280 characters.' : undefined}
              disabled={row === 'disabled'}
              readOnly={row === 'readonly'}
            />
          </div>
        )}
      />
      <Specimen label="Autosize with counter">
        <div style={{ width: 360 }}>
          <Textarea label="Release notes" maxLength={500} showCount defaultValue={'Adds the ocean brand.\nFixes border.strong contrast in both themes.\nNew density tokens.'} />
        </div>
      </Specimen>
    </SpecimenStack>
  ),
};
