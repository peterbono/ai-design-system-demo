import type { Meta, StoryObj } from '@storybook/react-vite';
import { DemoBox } from '../../stories/LayoutDemo';
import { SpecimenStack, Specimen } from '../../stories/StateGrid';
import { Container, type ContainerSize } from './Container';

const meta = {
  title: 'Layout/Container',
  component: Container,
  args: { size: 'lg', padding: 'md' },
  argTypes: {
    size: { control: 'inline-radio', options: ['sm', 'md', 'lg', 'xl', 'full'] },
    padding: { control: 'inline-radio', options: ['none', 'sm', 'md', 'lg'] },
    render: { control: false },
  },
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Container>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <Container {...args}>
      <DemoBox tall>Page content, centered at the lg width (960px)</DemoBox>
    </Container>
  ),
};

const SIZES: { size: ContainerSize; label: string }[] = [
  { size: 'sm', label: 'sm 640: forms, reading' },
  { size: 'md', label: 'md 720' },
  { size: 'lg', label: 'lg 960: settings' },
  { size: 'xl', label: 'xl 1200: dashboards, tables' },
];

export const AllStates: Story = {
  render: () => (
    <SpecimenStack>
      <Specimen label="Sizes">
        <div style={{ display: 'grid', gap: 'var(--space-3)', width: '100%' }}>
          {SIZES.map(({ size, label }) => (
            <Container key={size} size={size} padding="none">
              <DemoBox>{label}</DemoBox>
            </Container>
          ))}
        </div>
      </Specimen>
    </SpecimenStack>
  ),
};
