import type { CSSProperties } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Specimen, SpecimenStack, StateGrid } from '../../stories/StateGrid';
import { Textarea } from './Textarea';

const meta = {
  title: 'Forms/Textarea',
  component: Textarea,
  args: { label: 'Change summary', hint: 'Reviewers read this first. Say what changed and why.', placeholder: 'Darkens steel 600 so muted text passes 4.5:1 on the canvas.', disabled: false },
  argTypes: {
    // A control, so the Storybook measure (bridge specs --measure --variants) reaches the Disabled variants.
    disabled: { control: 'boolean' },
  },
} satisfies Meta<typeof Textarea>;

export default meta;
type Story = StoryObj<typeof meta>;

const narrow: Story['decorators'] = [(S) => <div style={{ maxWidth: 420 }}><S /></div>];

/** Reading text as a docs page sets it: body role, 65ch measure. The inline Textarea takes all of it from here. */
const page: CSSProperties = {
  maxWidth: '65ch',
  color: 'var(--color-text-default)',
  fontFamily: 'var(--typography-body-family)',
  fontSize: 'var(--typography-body-size)',
  lineHeight: 'var(--typography-body-line-height)',
  letterSpacing: 'var(--typography-body-tracking)',
};

export const Default: Story = { decorators: narrow };
export const WithCount: Story = { decorators: narrow, args: { maxLength: 280, showCount: true } };
export const Invalid: Story = { decorators: narrow, args: { error: 'Add a summary before you request review.' } };
export const Resizable: Story = { decorators: narrow, args: { autosize: false, rows: 4 } };

/** A paragraph edited in place: the text keeps the page's font, size and line height, the field shows on hover and focus. */
export const InAParagraph: Story = {
  name: 'In a paragraph',
  render: () => (
    <div style={page}>
      <h3 style={{ margin: '0 0 var(--space-2)', font: 'inherit', fontWeight: 'var(--font-weight-semibold)' }}>Summary</h3>
      <Textarea
        appearance="inline"
        aria-label="Summary"
        placeholder="One or two sentences: what it is for, and what to use instead."
        defaultValue="Multi-line text that grows with its content up to a maximum, with an optional character count. Give it a label prop or place it inside a Field."
      />
      <p style={{ margin: 'var(--space-4) 0 0' }}>
        The paragraph above is a textarea. This one is plain text, set in the same type, so you can compare the two.
      </p>
    </div>
  ),
};

/** One inline Textarea per list item, as the Library edits When to use and Accessibility lists. */
export const InAList: Story = {
  name: 'In a list',
  render: () => (
    <ul style={{ ...page, margin: 0, paddingLeft: 'var(--space-6)' }}>
      {[
        'Free text longer than one line: pull request summaries, release notes, review comments.',
        'showCount with maxLength when there is a hard limit.',
        '',
      ].map((text, i) => (
        <li key={i}>
          <Textarea appearance="inline" aria-label={`When to use, item ${i + 1}`} placeholder="Write one sentence" defaultValue={text} />
        </li>
      ))}
    </ul>
  ),
};

type Row = 'empty' | 'filled' | 'invalid' | 'disabled' | 'readonly';

const rows: { label: string; value: Row }[] = [
  { label: 'Empty', value: 'empty' },
  { label: 'Filled', value: 'filled' },
  { label: 'Invalid', value: 'invalid' },
  { label: 'Disabled', value: 'disabled' },
  { label: 'Read only', value: 'readonly' },
];
const columns = [{ label: 'Default' }, { label: 'Hover', pseudo: 'hover' as const }, { label: 'Focus', pseudo: 'focus-visible' as const }];

export const AllStates: Story = {
  render: () => (
    <SpecimenStack>
      <Specimen label="Field (default)">
        <StateGrid<Row>
          columns={columns}
          rows={rows}
          render={(row, col) => (
            <div style={{ width: 260 }}>
              <Textarea
                label={`Summary ${row} ${col.label}`}
                hideLabel
                rows={2}
                placeholder="What changed and why"
                defaultValue={row === 'empty' ? undefined : 'Darkens steel 600 so muted text passes on the canvas.'}
                error={row === 'invalid' ? 'Keep it under 280 characters.' : undefined}
                disabled={row === 'disabled'}
                readOnly={row === 'readonly'}
              />
            </div>
          )}
        />
      </Specimen>
      <Specimen label="Inline (in-place editing)">
        <StateGrid<Row>
          columns={columns}
          rows={rows}
          render={(row, col) => (
            <div style={{ ...page, width: 260, paddingInline: 'var(--space-3)' }}>
              <Textarea
                appearance="inline"
                label={`Inline summary ${row} ${col.label}`}
                hideLabel
                placeholder="What changed and why"
                defaultValue={row === 'empty' ? undefined : 'Darkens steel 600 so muted text passes on the canvas.'}
                error={row === 'invalid' ? 'Keep it under 280 characters.' : undefined}
                disabled={row === 'disabled'}
                readOnly={row === 'readonly'}
              />
            </div>
          )}
        />
      </Specimen>
      <Specimen label="Autosize with counter">
        <div style={{ width: 360 }}>
          <Textarea label="Release notes" maxLength={500} showCount defaultValue={'Adds the ocean brand.\nFixes border.strong contrast in both themes.\nNew density tokens.'} />
        </div>
      </Specimen>
    </SpecimenStack>
  ),
};
