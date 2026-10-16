import type { Meta, StoryObj } from '@storybook/react-vite';
import { Specimen, SpecimenStack, StateGrid } from '../../stories/StateGrid';
import { Link, type LinkVariant } from './Link';

const meta = {
  title: 'Actions/Link',
  component: Link,
  tags: ['autodocs'],
  args: { href: '#tokens', children: 'Read the token guidelines', variant: 'inline' },
  argTypes: {
    variant: { control: 'inline-radio', options: ['inline', 'standalone', 'subtle'] },
    render: { control: false },
  },
} satisfies Meta<typeof Link>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Inline: Story = {
  render: (args) => (
    <p style={{ maxWidth: '60ch', margin: 0 }}>
      Semantic tokens alias primitives per theme. <Link {...args} /> before you add a new one.
    </p>
  ),
};
export const Standalone: Story = { args: { variant: 'standalone', children: 'View all components' } };
export const External: Story = { args: { external: true, href: 'https://www.designtokens.org/', children: 'DTCG specification' } };

const ROWS: { label: string; value: LinkVariant }[] = [
  { label: 'Inline', value: 'inline' },
  { label: 'Standalone', value: 'standalone' },
  { label: 'Subtle', value: 'subtle' },
];

export const AllStates: Story = {
  render: () => (
    <SpecimenStack>
      <StateGrid
        columns={[{ label: 'Default' }, { label: 'Hover', pseudo: 'hover' }, { label: 'Focus visible', pseudo: 'focus-visible' }]}
        rows={ROWS}
        render={(variant) => (
          <Link variant={variant} href="#changelog">
            Changelog
          </Link>
        )}
      />
      <Specimen label="External">
        <Link external href="https://www.designtokens.org/">DTCG specification</Link>
      </Specimen>
    </SpecimenStack>
  ),
};
