import type { Meta, StoryObj } from '@storybook/react-vite';
import { Badge } from '../Badge';
import { Button } from '../Button';
import { Specimen, SpecimenStack } from '../../stories/StateGrid';
import { Card, CardBody, CardFooter, CardHeader } from './Card';

const meta = {
  title: 'Data display/Card',
  component: Card,
  args: { padding: 'default', interactive: false },
  argTypes: { padding: { control: 'inline-radio', options: ['none', 'compact', 'default'] } },
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

const narrow = [(Story: () => JSX.Element) => <div style={{ maxWidth: 420 }}><Story /></div>];

export const Default: Story = {
  decorators: narrow,
  render: (args) => (
    <Card {...args} aria-labelledby="card-release">
      <CardHeader>
        <span id="card-release">Release 1.4.0</span>
        <Badge tone="success">Published</Badge>
      </CardHeader>
      <CardBody>Adds a subtle Badge appearance and tightens focus styles. Two components changed, no token changes.</CardBody>
      <CardFooter>
        <Button variant="ghost" size="sm">View diff</Button>
        <Button size="sm">Approve</Button>
      </CardFooter>
    </Card>
  ),
};

export const Interactive: Story = {
  decorators: narrow,
  args: { interactive: true },
  render: (args) => (
    <Card {...args}>
      <CardHeader>
        <a href="#button" data-card-primary="">Button</a>
        <Badge tone="info">12 stories</Badge>
      </CardHeader>
      <CardBody>Triggers an action on the current screen. 4 variants, 3 sizes, 31 consumers.</CardBody>
    </Card>
  ),
};

export const AllStates: Story = {
  render: () => (
    <SpecimenStack>
      <Specimen label="Static, interactive (hover), interactive (focus visible)">
        {(['default', 'hover', 'focus'] as const).map((state) => (
          <div key={state} style={{ width: 280 }}>
            <Card interactive={state !== 'default'} className={state === 'hover' ? 'pseudo-hover' : undefined}>
              <CardHeader>
                <a href="#tokens" data-card-primary="" className={state === 'focus' ? 'pseudo-focus-visible' : undefined}>
                  Color tokens
                </a>
                <Badge tone="warning">2 failing</Badge>
              </CardHeader>
              <CardBody>48 semantic tokens. 2 contrast pairs below 4.5:1 in dark.</CardBody>
            </Card>
          </div>
        ))}
      </Specimen>
      <Specimen label="Padding: default, compact, none">
        {(['default', 'compact', 'none'] as const).map((padding) => (
          <div key={padding} style={{ width: 280 }}>
            <Card padding={padding}>
              <CardHeader>Owners</CardHeader>
              <CardBody>Design: Florian G. Tech: platform team.</CardBody>
              <CardFooter>
                <Button size="sm" variant="secondary">Edit owners</Button>
              </CardFooter>
            </Card>
          </div>
        ))}
      </Specimen>
    </SpecimenStack>
  ),
};
