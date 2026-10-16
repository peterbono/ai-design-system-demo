import type { Meta, StoryObj } from '@storybook/react-vite';
import { Pencil, Plus } from 'lucide-react';
import { Specimen, SpecimenStack } from '../../stories/StateGrid';
import { Button } from '../Button';
import { Badge } from '../Badge';
import { PageHeader } from './PageHeader';

const meta = {
  title: 'Layout/PageHeader',
  component: PageHeader,
  args: {
    title: 'Spacing',
    lead: 'A 4 px base scale: step n is n times 4 px. Tight inside groups, generous between them.',
    meta: 'Updated 3 days ago, from packages/tokens/src/primitives/space.tokens.json',
  },
  argTypes: { actions: { control: false }, headingLevel: { control: 'inline-radio', options: [1, 2] } },
} satisfies Meta<typeof PageHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { actions: <Button variant="secondary" iconStart={Pencil}>Edit in Studio</Button> } };
export const TitleOnly: Story = { args: { lead: undefined, meta: undefined } };
export const TwoActions: Story = {
  args: {
    title: 'Tokens',
    actions: (
      <>
        <Button variant="secondary">Export</Button>
        <Button iconStart={Plus}>Create token</Button>
      </>
    ),
  },
};

export const AllStates: Story = {
  render: () => (
    <SpecimenStack>
      <Specimen label="Title, lead, meta, actions">
        <PageHeader title="Spacing" lead="A 4 px base scale." meta="Updated 3 days ago" actions={<Button variant="secondary" iconStart={Pencil}>Edit in Studio</Button>} />
      </Specimen>
      <Specimen label="Title only">
        <PageHeader title="Install" />
      </Specimen>
      <Specimen label="Meta with a badge">
        <PageHeader title="Button" lead="Triggers an action on the current screen." meta={<Badge tone="success">Stable</Badge>} />
      </Specimen>
      <Specimen label="Heading level 2">
        <PageHeader headingLevel={2} title="Overview" lead="Read the system, check its health." />
      </Specimen>
      <Specimen label="Narrow container, actions wrap">
        <div style={{ maxWidth: 360 }}>
          <PageHeader title="Typography" lead="Plex Sans for UI and body text." actions={<Button variant="secondary">Edit in Studio</Button>} />
        </div>
      </Specimen>
    </SpecimenStack>
  ),
};
