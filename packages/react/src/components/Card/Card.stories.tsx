import type { Meta, StoryObj } from '@storybook/react-vite';
import { Badge } from '../Badge';
import { Button } from '../Button';
import { Card, CardBody, CardFooter, CardHeader } from './Card';

const meta = {
  title: 'Components/Card',
  component: Card,
  tags: ['autodocs'],
  decorators: [(Story) => <div style={{ maxWidth: 420 }}><Story /></div>],
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <Card {...args} aria-labelledby="card-title">
      <CardHeader>
        <span id="card-title">Release 1.4.0</span>
      </CardHeader>
      <CardBody>
        Adds a subtle Badge appearance and tightens focus styles. Two components changed, no token changes.
      </CardBody>
      <CardFooter>
        <Button variant="ghost" size="sm">View diff</Button>
        <Button size="sm">Approve</Button>
      </CardFooter>
    </Card>
  ),
};

export const WithStatus: Story = {
  render: (args) => (
    <Card {...args} aria-labelledby="status-title">
      <CardHeader style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span id="status-title">Token build</span>
        <Badge tone="success">Passing</Badge>
      </CardHeader>
      <CardBody>Style Dictionary generated CSS variables for light and dark themes.</CardBody>
    </Card>
  ),
};

export const Interactive: Story = {
  args: { interactive: true },
  render: (args) => (
    <Card {...args} aria-labelledby="interactive-title">
      <CardHeader>
        <span id="interactive-title">Hover me</span>
      </CardHeader>
      <CardBody>The card lifts on hover to signal that the whole surface is clickable.</CardBody>
    </Card>
  ),
};
