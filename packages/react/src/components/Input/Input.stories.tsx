import type { Meta, StoryObj } from '@storybook/react-vite';
import { Input } from './Input';

const meta = {
  title: 'Components/Input',
  component: Input,
  tags: ['autodocs'],
  args: { label: 'Work email', placeholder: 'name@company.com', type: 'email' },
  decorators: [(Story) => <div style={{ maxWidth: 360 }}><Story /></div>],
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const WithHint: Story = { args: { hint: 'We only use it for sign-in links.' } };
export const WithError: Story = {
  args: { hint: 'We only use it for sign-in links.', error: 'Enter an email address like name@company.com.', defaultValue: 'florian@' },
};
export const Disabled: Story = { args: { disabled: true, defaultValue: 'locked@company.com' } };
