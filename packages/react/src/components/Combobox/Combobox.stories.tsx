import { useEffect, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Search } from 'lucide-react';
import { Specimen, SpecimenStack, StateGrid } from '../../stories/StateGrid';
import { Button } from '../Button';
import { Dialog, DialogClose, DialogContent } from '../Dialog';
import { Icon } from '../Icon';
import { Combobox, type ComboboxOption } from './Combobox';

const REVIEWERS: ComboboxOption[] = [
  { value: 'ada', label: 'Ada Moreau', description: 'Design owner', group: 'Owners' },
  { value: 'bao', label: 'Bao Tran', description: 'Tech owner', group: 'Owners' },
  { value: 'chloe', label: 'Chloe Martin', description: 'Product designer', group: 'Contributors' },
  { value: 'dev', label: 'Dev Patel', description: 'Front-end engineer', group: 'Contributors' },
  { value: 'emma', label: 'Emma Rossi', description: 'Away until Monday', group: 'Contributors', disabled: true },
];

const COMPONENTS: ComboboxOption[] = ['Accordion', 'Alert', 'Avatar', 'Badge', 'Breadcrumb', 'Button', 'Card', 'Checkbox', 'Combobox', 'Dialog', 'Drawer', 'Input', 'Menu', 'Popover', 'Select', 'Switch', 'Table', 'Tabs', 'Toast', 'Tooltip'].map(
  (name) => ({ value: name.toLowerCase(), label: name }),
);

const meta = {
  title: 'Forms/Combobox',
  component: Combobox,
  args: { label: 'Component', options: COMPONENTS, placeholder: 'Search components', hint: 'Type to filter 20 components.', disabled: false },
  argTypes: {
    // A control, so the Storybook measure (bridge specs --measure --variants) reaches the Disabled variants.
    disabled: { control: 'boolean' },
    size: { control: 'inline-radio', options: ['sm', 'md', 'lg'] },
    prefix: { control: false },
    options: { control: false },
    filter: { control: false },
  },
} satisfies Meta<typeof Combobox>;

export default meta;
type Story = StoryObj<typeof meta>;

const narrow = [(Story: () => JSX.Element) => <div style={{ maxWidth: 360 }}><Story /></div>];

export const Default: Story = { decorators: narrow };

const FAMILIES: ComboboxOption[] = [
  { value: 'button', label: 'Button', description: 'Actions' },
  { value: 'select', label: 'Select', description: 'Forms' },
  { value: 'combobox', label: 'Combobox', description: 'Forms' },
  { value: 'dialog', label: 'Dialog', description: 'Overlays' },
  { value: 'table', label: 'Table', description: 'Data display' },
];

/** Inside a Dialog: the list opens above the dialog (popover layer), focus stays in the dialog. */
export const InsideDialog: Story = {
  render: () => (
    <Dialog defaultOpen>
      <DialogContent
        title="Add a variant"
        description="Which component gets the new option?"
        footer={
          <>
            <DialogClose render={<Button variant="secondary" />}>Cancel</DialogClose>
            <Button>Continue</Button>
          </>
        }
      >
        <Combobox label="Component" options={FAMILIES} placeholder="Type a name, for example Button" defaultOpen />
      </DialogContent>
    </Dialog>
  ),
};
export const Grouped: Story = {
  decorators: narrow,
  args: { label: 'Reviewer', options: REVIEWERS, placeholder: 'Search people', hint: undefined },
};
export const Multiple: Story = {
  decorators: narrow,
  args: { label: 'Reviewers', options: REVIEWERS, multiple: true, defaultValue: ['ada', 'dev'], placeholder: 'Add reviewers', hint: 'At least one owner must approve.' },
};
export const WithError: Story = {
  decorators: narrow,
  args: { error: 'Choose a component from the list.', defaultInputValue: 'Buton' },
};

/** The popup rendered open, for review and screenshots. */
export const Open: Story = {
  decorators: [(Story) => <div style={{ maxWidth: 360, minHeight: 380 }}><Story /></div>],
  args: { label: 'Reviewer', options: REVIEWERS, defaultOpen: true, defaultValue: 'bao', hint: undefined, prefix: <Icon icon={Search} size="sm" /> },
};

/** Async search: the input is controlled, results arrive after a delay, filtering happens on the "server". */
export const AsyncSearch: Story = {
  decorators: [(Story) => <div style={{ maxWidth: 360, minHeight: 320 }}><Story /></div>],
  render: (args) => {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<ComboboxOption[]>([]);
    const [loading, setLoading] = useState(false);
    useEffect(() => {
      if (!query.trim()) {
        setResults([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      const id = setTimeout(() => {
        setResults(REVIEWERS.filter((r) => r.label.toLowerCase().includes(query.trim().toLowerCase())).map(({ group: _group, ...r }) => r));
        setLoading(false);
      }, 600);
      return () => clearTimeout(id);
    }, [query]);
    return (
      <Combobox
        {...args}
        label="Assign reviewer"
        hint="Search people in this workspace."
        options={results}
        filter={null}
        inputValue={query}
        onInputValueChange={setQuery}
        loading={loading}
        loadingMessage="Searching people"
        emptyMessage={query ? `No one matches "${query}".` : 'Start typing a name.'}
        placeholder="Type a name"
        prefix={<Icon icon={Search} size="sm" />}
      />
    );
  },
};

/** Loading row, rendered open. */
export const Loading: Story = {
  decorators: [(Story) => <div style={{ maxWidth: 360, minHeight: 200 }}><Story /></div>],
  args: { label: 'Assign reviewer', options: [], filter: null, loading: true, loadingMessage: 'Searching people', defaultOpen: true, hint: undefined },
};

export const AllStates: Story = {
  render: () => (
    <SpecimenStack>
      <StateGrid
        columns={[{ label: 'Default' }, { label: 'Hover', pseudo: 'hover' }, { label: 'Focus', pseudo: 'focus-visible' }]}
        rows={[
          { label: 'Empty', value: 'empty' },
          { label: 'Selected', value: 'selected' },
          { label: 'Invalid', value: 'invalid' },
          { label: 'Disabled', value: 'disabled' },
        ]}
        render={(state, col) => (
          <div style={{ width: 240 }}>
            <Combobox
              label={`${state} ${col.label}`}
              hideLabel
              options={COMPONENTS}
              placeholder="Search components"
              defaultValue={state === 'empty' ? undefined : 'button'}
              error={state === 'invalid' ? 'Choose from the list.' : undefined}
              disabled={state === 'disabled'}
            />
          </div>
        )}
      />
      <Specimen label="Multiple with chips">
        <div style={{ width: 320 }}>
          <Combobox label="Reviewers" multiple options={REVIEWERS} defaultValue={['ada', 'bao', 'dev']} />
        </div>
      </Specimen>
      <Specimen label="Sizes (follow density)">
        <div style={{ display: 'grid', gap: 12, width: 280 }}>
          <Combobox label="Small" size="sm" options={COMPONENTS} placeholder="sm" />
          <Combobox label="Medium" options={COMPONENTS} placeholder="md" />
          <Combobox label="Large" size="lg" options={COMPONENTS} placeholder="lg" />
        </div>
      </Specimen>
    </SpecimenStack>
  ),
};
