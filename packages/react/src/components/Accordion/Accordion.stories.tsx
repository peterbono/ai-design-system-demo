import type { Meta, StoryObj } from '@storybook/react-vite';
import { Badge } from '../Badge';
import { Specimen, SpecimenStack } from '../../stories/StateGrid';
import { Accordion, AccordionItem } from './Accordion';

const meta = {
  title: 'Data display/Accordion',
  component: Accordion,
  args: { multiple: false, headingLevel: 3, appearance: 'contained', children: null },
  argTypes: {
    appearance: { control: 'inline-radio', options: ['contained', 'flush'] },
    headingLevel: { control: 'inline-radio', options: [2, 3, 4, 5, 6] },
    children: { control: false },
  },
  decorators: [(Story) => <div style={{ maxWidth: 560 }}><Story /></div>],
} satisfies Meta<typeof Accordion>;

export default meta;
type Story = StoryObj<typeof meta>;

const items = (
  <>
    <AccordionItem value="color" title="Color tokens" meta="48">
      Semantic color tokens alias the palette roles of the active brand. Components only read these.
    </AccordionItem>
    <AccordionItem value="space" title="Spacing tokens" meta="16">
      A 4px scale from space.0-5 (2px) to space.24 (96px). Density tokens pick from it.
    </AccordionItem>
    <AccordionItem value="motion" title="Motion tokens" meta="10">
      Durations collapse to 0ms when the user prefers reduced motion.
    </AccordionItem>
  </>
);

export const Default: Story = { render: (args) => <Accordion {...args}>{items}</Accordion> };
export const Multiple: Story = { args: { multiple: true, defaultValue: ['color', 'space'] }, render: (args) => <Accordion {...args}>{items}</Accordion> };
export const Flush: Story = { args: { appearance: 'flush' }, render: (args) => <Accordion {...args}>{items}</Accordion> };

export const AllStates: Story = {
  render: () => (
    <SpecimenStack>
      <Specimen label="Open, closed, disabled; hover and focus on the second trigger">
        <div style={{ width: '100%' }}>
          <Accordion defaultValue={['color']}>
            <AccordionItem value="color" title="Color tokens" meta={<Badge tone="success" size="sm">Passing</Badge>}>
              220 contrast checks pass in bridge and ocean, light and dark.
            </AccordionItem>
            <AccordionItem value="space" title="Spacing tokens (hover)" className="pseudo-hover-all">
              Hover state.
            </AccordionItem>
            <AccordionItem value="type" title="Typography tokens (focus visible)" className="pseudo-focus-visible-all">
              Focus state.
            </AccordionItem>
            <AccordionItem value="legacy" title="Legacy tokens" meta="Removed in 2.0" disabled>
              Not available.
            </AccordionItem>
          </Accordion>
        </div>
      </Specimen>
      <Specimen label="Flush (inside a card or a panel)">
        <div style={{ width: '100%' }}>
          <Accordion appearance="flush" defaultValue={['space']}>{items}</Accordion>
        </div>
      </Specimen>
    </SpecimenStack>
  ),
};
