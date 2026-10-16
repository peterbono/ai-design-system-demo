import type { Meta, StoryObj } from '@storybook/react-vite';
import { Specimen, SpecimenStack, StateGrid } from '../../stories/StateGrid';
import { Slider } from './Slider';

const meta = {
  title: 'Forms/Slider',
  component: Slider,
  tags: ['autodocs'],
  args: { label: 'Minimum contrast', defaultValue: 4.5, min: 3, max: 7, step: 0.5, hint: 'Pairs below this ratio fail the token build.' },
} satisfies Meta<typeof Slider>;

export default meta;
type Story = StoryObj<typeof meta>;

const narrow: Story['decorators'] = [(S) => <div style={{ maxWidth: 400 }}><S /></div>];

export const Default: Story = { decorators: narrow };
export const Range: Story = { decorators: narrow, args: { label: 'Spacing range', hint: 'Steps shown in the scale preview.', defaultValue: [8, 32], min: 0, max: 64, step: 4 } };
export const Percent: Story = { decorators: narrow, args: { label: 'Scrim opacity', hint: undefined, defaultValue: 0.48, min: 0, max: 1, step: 0.01, format: { style: 'percent' } } };

type Row = 'default' | 'invalid' | 'disabled';

export const AllStates: Story = {
  render: () => (
    <SpecimenStack>
      <StateGrid<Row>
        columns={[{ label: 'Default' }, { label: 'Hover', pseudo: 'hover' }, { label: 'Focus visible', pseudo: 'focus-visible' }]}
        rows={[
          { label: 'Default', value: 'default' },
          { label: 'Invalid', value: 'invalid' },
          { label: 'Disabled', value: 'disabled' },
        ]}
        render={(row, col) => (
          <div style={{ width: 240 }}>
            <Slider label={`Opacity ${row} ${col.label}`} hideLabel defaultValue={40} disabled={row === 'disabled'} error={row === 'invalid' ? 'Keep it above 50.' : undefined} />
          </div>
        )}
      />
      <Specimen label="Range">
        <div style={{ width: 320 }}>
          <Slider label="Spacing range" defaultValue={[8, 32]} min={0} max={64} step={4} />
        </div>
      </Specimen>
    </SpecimenStack>
  ),
};
