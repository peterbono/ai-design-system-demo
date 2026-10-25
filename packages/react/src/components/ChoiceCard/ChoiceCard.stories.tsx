import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Specimen, SpecimenStack, StateGrid } from '../../stories/StateGrid';
import { TokenValue } from '../TokenValue';
import { ChoiceCard, ChoiceCardGroup } from './ChoiceCard';

/** A 390px phone viewport: the horizontal cards stack once they no longer fit. */
const phone = {
  parameters: { viewport: { options: { phone390: { name: 'Phone 390', styles: { width: '390px', height: '844px' }, type: 'mobile' } } } },
  globals: { viewport: { value: 'phone390', isRotated: false } },
};

const meta = {
  title: 'Forms/ChoiceCard',
  component: ChoiceCardGroup,
  args: { label: 'Which value should this change keep?', orientation: 'horizontal', hideLabel: false, disabled: false, children: null },
  argTypes: {
    orientation: { control: 'inline-radio', options: ['horizontal', 'vertical'] },
    label: { control: 'text' },
    description: { control: 'text' },
    error: { control: 'text' },
    children: { control: false },
  },
  decorators: [(Story) => <div style={{ maxWidth: 640 }}><Story /></div>],
} satisfies Meta<typeof ChoiceCardGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

function ConflictCards() {
  return (
    <>
      <ChoiceCard value="mine" title="Keep mine" description={<TokenValue value="{color.harbor.600}" resolved="#1B5C9E" size="sm" />} />
      <ChoiceCard value="library" title="Use the library's" description={<TokenValue value="{color.harbor.700}" resolved="#0B4A8B" size="sm" />} />
    </>
  );
}

export const Conflict: Story = {
  render: (args) => {
    const [value, setValue] = useState('library');
    return (
      <ChoiceCardGroup {...args} description="color.action.primary.bg changed in the library and in your change." value={value} onValueChange={setValue}>
        <ConflictCards />
      </ChoiceCardGroup>
    );
  },
};

export const StartingBrand: Story = {
  render: () => (
    <ChoiceCardGroup label="Starting brand" defaultValue="bridge">
      <ChoiceCard value="bridge" title="Bridge" description="Deep Harbor actions, Fraunces headings. The default." />
      <ChoiceCard value="ocean" title="Ocean" description="Brighter blue actions, rounder corners." />
      <ChoiceCard value="blank" title="Start blank" description="Neutral grays. You add your own palette." />
    </ChoiceCardGroup>
  ),
};

export const Vertical: Story = {
  render: () => (
    <ChoiceCardGroup label="Corner style" orientation="vertical" defaultValue="soft">
      <ChoiceCard value="sharp" title="Sharp" description="2px on controls, 4px on containers." />
      <ChoiceCard value="soft" title="Soft" description="6px on controls, 12px on containers." />
      <ChoiceCard value="round" title="Round" description="Pill controls, 16px on containers." />
    </ChoiceCardGroup>
  ),
};

export const WithError: Story = {
  render: () => (
    <ChoiceCardGroup label="Which value should this change keep?" error="Pick a value before you add it to the library.">
      <ConflictCards />
    </ChoiceCardGroup>
  ),
};

export const DisabledCard: Story = {
  render: () => (
    <ChoiceCardGroup label="Starting brand" defaultValue="bridge">
      <ChoiceCard value="bridge" title="Bridge" description="Deep Harbor actions, Fraunces headings." />
      <ChoiceCard value="ocean" title="Ocean" description="Only on the Team plan." disabled />
    </ChoiceCardGroup>
  ),
};

/** Narrow: the two cards stack, full width, in reading order. */
export const NarrowConflict: Story = {
  ...phone,
  render: () => (
    <ChoiceCardGroup label="Which value should this change keep?" defaultValue="library">
      <ConflictCards />
    </ChoiceCardGroup>
  ),
};

type Row = 'unchecked' | 'checked' | 'disabled' | 'disabledChecked' | 'invalid';

export const AllStates: Story = {
  decorators: [(Story) => <Story />],
  render: () => (
    <SpecimenStack>
      <StateGrid<Row>
        columns={[{ label: 'Default' }, { label: 'Hover', pseudo: 'hover' }, { label: 'Focus visible', pseudo: 'focus-visible' }, { label: 'Active', pseudo: 'active' }]}
        rows={[
          { label: 'Unchecked', value: 'unchecked' },
          { label: 'Checked', value: 'checked' },
          { label: 'Disabled', value: 'disabled' },
          { label: 'Disabled, checked', value: 'disabledChecked' },
          { label: 'Invalid group', value: 'invalid' },
        ]}
        render={(row, col) => (
          <div style={{ width: 240 }}>
            <ChoiceCardGroup
              label={`${row} ${col.label}`}
              hideLabel
              orientation="vertical"
              defaultValue={row === 'checked' || row === 'disabledChecked' ? 'library' : undefined}
              disabled={row === 'disabled' || row === 'disabledChecked'}
              error={row === 'invalid' ? 'Pick a value.' : undefined}
            >
              <ChoiceCard value="library" title="Use the library's" description="{color.harbor.700}" />
            </ChoiceCardGroup>
          </div>
        )}
      />
      <Specimen label="Title only">
        <div style={{ width: 480 }}>
          <ChoiceCardGroup label="Keep which version?" defaultValue="mine">
            <ChoiceCard value="mine" title="Keep mine" />
            <ChoiceCard value="library" title="Use the library's" />
          </ChoiceCardGroup>
        </div>
      </Specimen>
      <Specimen label="With TokenValue descriptions">
        <div style={{ width: 560 }}>
          <ChoiceCardGroup label="Which value should this change keep?" description="color.action.primary.bg changed in both places." defaultValue="mine">
            <ConflictCards />
          </ChoiceCardGroup>
        </div>
      </Specimen>
    </SpecimenStack>
  ),
};
