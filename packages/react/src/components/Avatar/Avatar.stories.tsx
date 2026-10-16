import type { Meta, StoryObj } from '@storybook/react-vite';
import { Specimen, SpecimenStack } from '../../stories/StateGrid';
import { Avatar, AvatarGroup } from './Avatar';

// A tiny inline SVG portrait so stories work offline.
const PHOTO =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#c7ced8"/><circle cx="32" cy="26" r="12" fill="#636d79"/><rect x="12" y="42" width="40" height="22" rx="11" fill="#636d79"/></svg>',
  );

const meta = {
  title: 'Data display/Avatar',
  component: Avatar,
  args: { name: 'Florian Gouloubi', size: 'md' },
  argTypes: { size: { control: 'inline-radio', options: ['xs', 'sm', 'md', 'lg'] } },
} satisfies Meta<typeof Avatar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Initials: Story = {};
export const Image: Story = { args: { src: PHOTO } };
export const BrokenImage: Story = { args: { src: 'https://invalid.example/avatar.png', name: 'Ana Lima' } };

const PEOPLE = ['Florian Gouloubi', 'Ana Lima', 'Kenji Sato', 'Maya Okafor', 'Lucas Martin', 'Ines Haddad', 'Tom Becker'];

export const Group: Story = {
  render: () => (
    <AvatarGroup aria-label="Reviewers" max={4}>
      {PEOPLE.map((p) => (
        <Avatar key={p} name={p} />
      ))}
    </AvatarGroup>
  ),
};

export const AllStates: Story = {
  render: () => (
    <SpecimenStack>
      <Specimen label="Sizes: xs, sm, md, lg (initials)">
        {(['xs', 'sm', 'md', 'lg'] as const).map((s) => (
          <Avatar key={s} size={s} name="Kenji Sato" />
        ))}
      </Specimen>
      <Specimen label="Image, broken image (falls back to initials), single word name">
        <Avatar name="Ana Lima" src={PHOTO} size="lg" />
        <Avatar name="Maya Okafor" src="https://invalid.example/maya.png" size="lg" />
        <Avatar name="Platform" size="lg" />
      </Specimen>
      <Specimen label="Group with overflow (max 3 and max 5)">
        <AvatarGroup aria-label="Reviewers" max={3}>
          {PEOPLE.map((p) => <Avatar key={p} name={p} />)}
        </AvatarGroup>
        <AvatarGroup aria-label="Owners" max={5} size="sm">
          {PEOPLE.map((p) => <Avatar key={p} name={p} size="sm" />)}
        </AvatarGroup>
      </Specimen>
    </SpecimenStack>
  ),
};
