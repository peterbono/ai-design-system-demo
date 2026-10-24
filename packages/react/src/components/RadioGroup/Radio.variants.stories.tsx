import type { Meta, StoryObj } from '@storybook/react-vite';
import { Radio, RadioGroup } from './RadioGroup';

// Figma variants of the Radio set, one story per state. A radio is checked through its group's value, not a prop of
// its own: `checked` is a story arg the render turns into the group's value, named like the Figma axis so the
// Storybook measure (bridge specs --measure) maps each story to its variant. Texts are the set's defaults.

type Args = { label: string; checked: boolean; disabled: boolean };

const meta = {
  title: 'Figma variants/Radio',
  args: { label: 'Label', checked: false, disabled: false },
  argTypes: { checked: { control: 'boolean' }, disabled: { control: 'boolean' }, label: { control: 'text' } },
  render: ({ label, checked, disabled }) => (
    <RadioGroup label="Choice" hideLabel value={checked ? 'radio' : ''}>
      <Radio value="radio" label={label} disabled={disabled} />
    </RadioGroup>
  ),
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Unchecked: Story = {};
export const Checked: Story = { args: { checked: true } };
export const Disabled: Story = { args: { disabled: true } };
export const CheckedDisabled: Story = { args: { checked: true, disabled: true } };
