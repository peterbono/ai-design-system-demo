import type { Meta, StoryObj } from '@storybook/react-vite';
import { Input } from '../Input';
import { Field } from './Field';

const meta = {
  title: 'Forms/Field',
  component: Field,
  tags: ['autodocs'],
  args: { label: 'Repository', description: 'Owner and name, like acme/design-tokens.', children: null },
  decorators: [(Story) => <div style={{ maxWidth: 360 }}><Story /></div>],
} satisfies Meta<typeof Field>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { render: (args) => <Field {...args}><Input placeholder="acme/design-tokens" /></Field> };
export const Invalid: Story = {
  args: { error: 'Repository not found. Check the owner and the name.' },
  render: (args) => <Field {...args}><Input defaultValue="acme/desing-tokens" /></Field>,
};
export const Required: Story = { args: { required: true }, render: (args) => <Field {...args}><Input /></Field> };
export const Disabled: Story = { args: { disabled: true }, render: (args) => <Field {...args}><Input defaultValue="acme/design-tokens" /></Field> };

export const AllStates: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 24 }}>
      <Field label="Default" description="Description sits under the label."><Input placeholder="Placeholder" /></Field>
      <Field label="Required" required><Input /></Field>
      <Field label="Invalid" error="Name the problem and how to fix it."><Input defaultValue="wrong value" /></Field>
      <Field label="Disabled" disabled description="Explains why it is disabled."><Input defaultValue="locked" /></Field>
    </div>
  ),
};
