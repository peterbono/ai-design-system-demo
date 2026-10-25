import type { Meta, StoryObj } from '@storybook/react-vite';
import { Accordion, AccordionItem } from './Accordion';

// Figma variants of the AccordionItem set, one story per state, named like the Figma axes so the Storybook measure
// (bridge specs --measure) maps each story to its variant. Texts are the set's defaults.

type Args = { title: string; disabled: boolean };

const meta = {
  title: 'Figma variants/AccordionItem',
  args: { title: 'Title', disabled: false },
  argTypes: { disabled: { control: 'boolean' }, title: { control: 'text' } },
  render: ({ title, disabled }) => (
    <Accordion>
      <AccordionItem value="item" title={title} disabled={disabled}>
        AccordionItem
      </AccordionItem>
    </Accordion>
  ),
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Disabled: Story = { args: { disabled: true } };
