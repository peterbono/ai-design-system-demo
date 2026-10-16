import type { Meta, StoryObj } from '@storybook/react-vite';
import { Specimen, SpecimenStack } from '../../stories/StateGrid';
import { Checkbox } from '../Checkbox';
import { CheckboxGroup } from './CheckboxGroup';

const meta = {
  title: 'Forms/CheckboxGroup',
  component: CheckboxGroup,
  args: { label: 'Notify me about', children: null },
} satisfies Meta<typeof CheckboxGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

const items = (
  <>
    <Checkbox value="reviews" label="Review requests" />
    <Checkbox value="merges" label="Merged pull requests" />
    <Checkbox value="releases" label="Releases" description="Includes the changelog for each package." />
  </>
);

export const Default: Story = { args: { defaultValue: ['reviews'], description: 'We send one email per event.' }, render: (args) => <CheckboxGroup {...args}>{items}</CheckboxGroup> };

export const SelectAll: Story = {
  render: () => (
    <CheckboxGroup label="Themes to publish" allValues={['light', 'dark', 'high-contrast']} defaultValue={['light']}>
      <Checkbox parent label="All themes" />
      <Checkbox value="light" label="Light" />
      <Checkbox value="dark" label="Dark" />
      <Checkbox value="high-contrast" label="High contrast" />
    </CheckboxGroup>
  ),
};

export const Invalid: Story = {
  args: { error: 'Pick at least one reviewer group.', label: 'Reviewers', required: true },
  render: (args) => (
    <CheckboxGroup {...args}>
      <Checkbox value="design" label="Design owners" />
      <Checkbox value="tech" label="Tech owners" />
    </CheckboxGroup>
  ),
};

export const AllStates: Story = {
  render: () => (
    <SpecimenStack>
      <Specimen label="Parent with mixed state">
        <CheckboxGroup label="Themes to publish" allValues={['light', 'dark', 'high-contrast']} defaultValue={['light', 'dark']}>
          <Checkbox parent label="All themes" />
          <Checkbox value="light" label="Light" />
          <Checkbox value="dark" label="Dark" />
          <Checkbox value="high-contrast" label="High contrast" />
        </CheckboxGroup>
      </Specimen>
      <Specimen label="Horizontal">
        <CheckboxGroup label="Platforms" orientation="horizontal" defaultValue={['web']}>
          <Checkbox value="web" label="Web" />
          <Checkbox value="ios" label="iOS" />
          <Checkbox value="android" label="Android" />
        </CheckboxGroup>
      </Specimen>
      <Specimen label="Invalid">
        <CheckboxGroup label="Reviewers" required error="Pick at least one reviewer group.">
          <Checkbox value="design" label="Design owners" />
          <Checkbox value="tech" label="Tech owners" />
        </CheckboxGroup>
      </Specimen>
      <Specimen label="Disabled">
        <CheckboxGroup label="Notify me about" disabled defaultValue={['reviews']}>
          {items}
        </CheckboxGroup>
      </Specimen>
    </SpecimenStack>
  ),
};
