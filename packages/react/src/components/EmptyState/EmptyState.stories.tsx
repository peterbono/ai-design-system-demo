import type { Meta, StoryObj } from '@storybook/react-vite';
import { GitPullRequest, Palette, SearchX } from 'lucide-react';
import { Specimen, SpecimenStack } from '../../stories/StateGrid';
import { Button } from '../Button';
import { Link } from '../Link';
import { EmptyState } from './EmptyState';

const meta = {
  title: 'Feedback/EmptyState',
  component: EmptyState,
  args: {
    icon: GitPullRequest,
    title: 'No pull requests yet',
    description: 'Changes you sync from Figma open a pull request here, ready for review.',
    size: 'md',
  },
  argTypes: { size: { control: 'inline-radio', options: ['sm', 'md', 'lg'] }, icon: { control: false }, actions: { control: false } },
} satisfies Meta<typeof EmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    actions: (
      <>
        <Button>Sync from Figma</Button>
        <Button variant="ghost">Read the guide</Button>
      </>
    ),
  },
};
export const NoResults: Story = {
  args: {
    icon: SearchX,
    size: 'sm',
    title: 'No tokens match "brand.700"',
    description: 'Check the spelling or search by value, like #E64611.',
    actions: <Button variant="secondary" size="sm">Clear search</Button>,
  },
};

export const AllStates: Story = {
  render: () => (
    <SpecimenStack>
      <Specimen label="Large (whole page)">
        <div style={{ width: '100%', border: '1px dashed var(--color-border-default)' }}>
          <EmptyState
            size="lg"
            icon={Palette}
            title="Start your design system"
            description="Import variables from a Figma file or start from the Bridge starter tokens. You can change everything later."
            actions={
              <>
                <Button size="lg">Import from Figma</Button>
                <Button size="lg" variant="secondary">Use starter tokens</Button>
              </>
            }
          />
        </div>
      </Specimen>
      <Specimen label="Medium (panel)">
        <div style={{ width: 480, border: '1px dashed var(--color-border-default)' }}>
          <EmptyState
            icon={GitPullRequest}
            title="No pull requests yet"
            description="Changes you sync from Figma open a pull request here, ready for review."
            actions={<Button>Sync from Figma</Button>}
          />
        </div>
      </Specimen>
      <Specimen label="Small, start aligned (inside a table or card)">
        <div style={{ width: 420, border: '1px dashed var(--color-border-default)' }}>
          <EmptyState
            size="sm"
            align="start"
            icon={SearchX}
            title='No tokens match "brand.700"'
            description={<>Check the spelling or <Link href="#all">browse all tokens</Link>.</>}
          />
        </div>
      </Specimen>
    </SpecimenStack>
  ),
};
