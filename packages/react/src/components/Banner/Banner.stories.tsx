import type { Meta, StoryObj } from '@storybook/react-vite';
import { Eye, PencilRuler } from 'lucide-react';
import { Specimen, SpecimenStack } from '../../stories/StateGrid';
import { Button } from '../Button';
import { Banner } from './Banner';

/** A 390px phone viewport, so the media queries see a narrow screen (a narrow wrapper would not). */
const phone = {
  parameters: { viewport: { options: { phone390: { name: 'Phone 390', styles: { width: '390px', height: '844px' }, type: 'mobile' } } } },
  globals: { viewport: { value: 'phone390', isRotated: false } },
};

const meta = {
  title: 'Feedback/Banner',
  component: Banner,
  args: {
    title: 'Viewing the library as change #118. Nothing is saved.',
    appearance: 'strong',
  },
  argTypes: {
    appearance: { control: 'inline-radio', options: ['strong', 'neutral'] },
    sticky: { control: 'inline-radio', options: [undefined, 'top', 'below-header'] },
    icon: { control: false },
    actions: { control: false },
    title: { control: 'text' },
  },
  decorators: [(Story) => <div style={{ maxWidth: 960 }}><Story /></div>],
} satisfies Meta<typeof Banner>;

export default meta;
type Story = StoryObj<typeof meta>;

const backToLatest = <Button size="sm" variant="secondary">Back to latest library</Button>;

export const Preview: Story = { args: { icon: Eye, actions: backToLatest } };
export const WithDetail: Story = {
  args: {
    icon: Eye,
    actions: backToLatest,
    children: 'Components and tokens show the values of change #118. Publishing stays off until you go back.',
  },
};
export const Neutral: Story = {
  args: {
    appearance: 'neutral',
    icon: PencilRuler,
    title: 'Editing the Button guidelines',
    children: 'Changes stay in a draft until you open a pull request.',
    actions: (
      <>
        <Button size="sm" variant="secondary">Open pull request</Button>
        <Button size="sm" variant="ghost">Stop editing</Button>
      </>
    ),
  },
};
export const TitleOnly: Story = { args: { icon: Eye } };

/** Sticky at the top of the scroll area: the way back stays in view while the page scrolls. */
export const StickyTop: Story = {
  render: (args) => (
    <div style={{ height: 320, overflow: 'auto', border: 'var(--border-width-default) dashed var(--color-border-default)' }}>
      <Banner {...args} icon={Eye} actions={backToLatest} sticky="top" />
      {Array.from({ length: 12 }, (_, i) => (
        <p key={i} style={{ margin: 'var(--space-3) var(--space-4)' }}>
          color.action.primary.bg row {i + 1}
        </p>
      ))}
    </div>
  ),
};

/** Narrow: the text takes the full width and the actions go under it, each one filling the row. */
export const NarrowWithActions: Story = {
  ...phone,
  args: {
    icon: Eye,
    children: 'Publishing stays off until you go back.',
    actions: backToLatest,
  },
};

export const AllStates: Story = {
  render: () => (
    <SpecimenStack>
      <Specimen label="Strong: title, icon, action">
        <div style={{ width: '100%' }}>
          <Banner icon={Eye} title="Viewing the library as change #118. Nothing is saved." actions={backToLatest} />
        </div>
      </Specimen>
      <Specimen label="Strong: with detail">
        <div style={{ width: '100%' }}>
          <Banner icon={Eye} title="Viewing the library as change #118. Nothing is saved." actions={backToLatest}>
            Components and tokens show the values of change #118.
          </Banner>
        </div>
      </Specimen>
      <Specimen label="Neutral: two actions">
        <div style={{ width: '100%' }}>
          <Banner
            appearance="neutral"
            icon={PencilRuler}
            title="Editing the Button guidelines"
            actions={
              <>
                <Button size="sm" variant="secondary">Open pull request</Button>
                <Button size="sm" variant="ghost">Stop editing</Button>
              </>
            }
          >
            Changes stay in a draft until you open a pull request.
          </Banner>
        </div>
      </Specimen>
      <Specimen label="No icon, no action">
        <div style={{ width: '100%' }}>
          <Banner appearance="neutral" title="Read only: this library is archived." />
        </div>
      </Specimen>
      <Specimen label="Narrow container (wraps; full-width actions need a narrow viewport)">
        <div style={{ width: 360 }}>
          <Banner icon={Eye} title="Viewing the library as change #118. Nothing is saved." actions={backToLatest} />
        </div>
      </Specimen>
    </SpecimenStack>
  ),
};
