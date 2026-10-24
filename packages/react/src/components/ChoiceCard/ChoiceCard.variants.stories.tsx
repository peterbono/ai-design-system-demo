import type { Meta, StoryObj } from '@storybook/react-vite';
import { ChoiceCard, ChoiceCardGroup } from './ChoiceCard';

// Figma variants of the ChoiceCard set, one story per state. A card is checked through its group's value, not a prop
// of its own: `checked` is a story arg the render turns into the group's value, named like the Figma axis so the
// Storybook measure (bridge specs --measure) maps each story to its variant. Texts are the set's defaults.

type Args = { title: string; checked: boolean; disabled: boolean };

const meta = {
  title: 'Figma variants/ChoiceCard',
  args: { title: 'Title', checked: false, disabled: false },
  argTypes: { checked: { control: 'boolean' }, disabled: { control: 'boolean' }, title: { control: 'text' } },
  render: ({ title, checked, disabled }) => (
    <ChoiceCardGroup label="Choice" hideLabel value={checked ? 'card' : ''}>
      <ChoiceCard value="card" title={title} disabled={disabled} />
    </ChoiceCardGroup>
  ),
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Unchecked: Story = {};
export const Checked: Story = { args: { checked: true } };
export const Disabled: Story = { args: { disabled: true } };
export const CheckedDisabled: Story = { args: { checked: true, disabled: true } };
