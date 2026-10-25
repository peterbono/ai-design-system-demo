import type { Meta, StoryObj } from '@storybook/react-vite';
import { Download } from 'lucide-react';
import { Icon } from '../Icon';
import { Link } from '../Link';
import { Specimen, SpecimenStack } from '../../stories/StateGrid';
import { VisuallyHidden } from './VisuallyHidden';

const meta = {
  title: 'Foundations/VisuallyHidden',
  component: VisuallyHidden,
  args: { children: 'Download the release notes' },
  argTypes: { children: { control: 'text' } },
  // The hidden text is invisible by design: each story shows what is on screen and what a screen reader reads.
  render: (args) => (
    <Specimen label={`Screen readers read: "${String(args.children ?? '')}"`}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <Icon icon={Download} size="md" />
        <VisuallyHidden {...args} />
      </span>
    </Specimen>
  ),
} satisfies Meta<typeof VisuallyHidden>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const AllStates: Story = {
  render: () => (
    <SpecimenStack>
      <Specimen label={'Next to a symbol: screen readers read "Download the release notes"'}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Icon icon={Download} size="md" />
          <VisuallyHidden>Download the release notes</VisuallyHidden>
        </span>
      </Specimen>
      <Specimen label={'After an external link: screen readers add "(opens in a new tab)"'}>
        <Link href="#" external>
          Release notes
        </Link>
      </Specimen>
      <Specimen label={'Naming a loading region: screen readers read "Loading tokens"'}>
        <div aria-busy="true">
          <VisuallyHidden>Loading tokens</VisuallyHidden>
          <span aria-hidden="true">...</span>
        </div>
      </Specimen>
    </SpecimenStack>
  ),
};
