import type { Meta, StoryObj } from '@storybook/react-vite';
import { Specimen, SpecimenStack, StateGrid } from '../../stories/StateGrid';
import { TokenValue } from './TokenValue';

const meta = {
  title: 'Data display/TokenValue',
  component: TokenValue,
  args: { name: 'color.action.primary.bg', value: '{color.harbor.700}', resolved: '#0B4A8B', size: 'md', previous: false },
  argTypes: {
    size: { control: 'inline-radio', options: ['sm', 'md'] },
    swatch: { control: 'text' },
  },
} satisfies Meta<typeof TokenValue>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Literal: Story = { args: { name: 'color.harbor.700', value: '#0B4A8B', resolved: undefined } };
export const ValueOnly: Story = { args: { name: undefined, value: '{color.harbor.700}', resolved: '#0B4A8B' } };
export const NotAColor: Story = { args: { name: 'space.4', value: '16px', resolved: undefined } };
export const Small: Story = { args: { size: 'sm' } };
export const NoSwatch: Story = { args: { swatch: false } };

/** Before and after: the previous value struck through, then the new one. */
export const BeforeAfter: Story = {
  render: () => (
    <span style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-2)' }}>
      <TokenValue value="{color.harbor.600}" resolved="#1B5C9E" previous />
      <TokenValue value="{color.harbor.700}" resolved="#0B4A8B" />
    </span>
  ),
};

/** A long alias in a narrow cell breaks anywhere instead of overflowing. */
export const NarrowCell: Story = {
  render: () => (
    <div style={{ width: 220 }}>
      <TokenValue name="color.feedback.warning.border.subtle" value="{color.sand.300}" resolved="oklch(0.86 0.06 85)" />
    </div>
  ),
};

type Row = 'alias' | 'literal' | 'dimension' | 'previous' | 'valueOnly';

const ROWS: Record<Row, { name?: string; value: string; resolved?: string; previous?: boolean }> = {
  alias: { name: 'color.action.primary.bg', value: '{color.harbor.700}', resolved: '#0B4A8B' },
  literal: { name: 'color.surface.default', value: '#FFFFFF' },
  dimension: { name: 'radius.control', value: '{radius.md}', resolved: '8px' },
  previous: { name: 'color.text.muted', value: '{color.slate.500}', resolved: '#5B6472', previous: true },
  valueOnly: { value: 'oklch(0.55 0.12 250)' },
};

export const AllStates: Story = {
  render: () => (
    <SpecimenStack>
      <StateGrid<Row>
        columns={[{ label: 'md' }, { label: 'sm' }]}
        rows={[
          { label: 'Alias with resolved color', value: 'alias' },
          { label: 'White literal (hairline)', value: 'literal' },
          { label: 'Dimension, no swatch', value: 'dimension' },
          { label: 'Previous value', value: 'previous' },
          { label: 'Value only', value: 'valueOnly' },
        ]}
        render={(row, col) => <TokenValue {...ROWS[row]} size={col.label === 'sm' ? 'sm' : 'md'} />}
      />
      <Specimen label="Before and after in a sentence">
        <p style={{ margin: 0, maxWidth: 520 }}>
          color.action.primary.bg changes from <TokenValue value="{color.harbor.600}" resolved="#1B5C9E" previous size="sm" /> to{' '}
          <TokenValue value="{color.harbor.700}" resolved="#0B4A8B" size="sm" />.
        </p>
      </Specimen>
      <Specimen label="Narrow cell (wraps)">
        <div style={{ width: 220 }}>
          <TokenValue name="color.feedback.warning.border.subtle" value="{color.sand.300}" resolved="oklch(0.86 0.06 85)" />
        </div>
      </Specimen>
    </SpecimenStack>
  ),
};
