import type { Meta, StoryObj } from '@storybook/react-vite';
import { Specimen, SpecimenStack, StateGrid } from '../../stories/StateGrid';
import { CodeBlock } from './CodeBlock';

/** A 390px phone viewport, so the media queries see a narrow screen (a narrow wrapper would not). */
const phone = {
  parameters: { viewport: { options: { phone390: { name: 'Phone 390', styles: { width: '390px', height: '844px' }, type: 'mobile' } } } },
  globals: { viewport: { value: 'phone390', isRotated: false } },
};

const MCP_COMMAND = 'claude mcp add bridge --env BRIDGE_TOKEN=bridge_live_8f2c41 -- npx -y @bridge-ds/mcp@latest --repo acme/design-tokens';

const meta = {
  title: 'Data display/CodeBlock',
  component: CodeBlock,
  args: { code: 'npm install @bridge-ds/react', label: 'Install', wrap: true, hideCopy: false },
  argTypes: { label: { control: 'text' }, onCopy: { control: false }, codeProps: { control: false } },
  decorators: [(Story) => <div style={{ maxWidth: 560 }}><Story /></div>],
} satisfies Meta<typeof CodeBlock>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const NoLabel: Story = { args: { label: undefined, code: 'npx @bridge-ds/cli publish --dry-run' } };
export const LongCommandScrolls: Story = { args: { label: 'Add the MCP server', code: MCP_COMMAND, wrap: false } };
export const LongCommandWraps: Story = { args: { label: 'Add the MCP server', code: MCP_COMMAND, wrap: true } };
export const MultiLine: Story = {
  args: {
    label: 'Use a token in CSS',
    code: '.publish {\n  background: var(--color-action-primary-bg);\n  color: var(--color-action-primary-text);\n}',
  },
};
export const ReadOnly: Story = { args: { label: 'Token file', code: 'tokens/semantic/color.json', hideCopy: true } };
export const CustomLabels: Story = { args: { label: 'Token name', code: 'color.action.primary.bg', copyLabel: 'Copy name', copiedLabel: 'Name copied' } };

/** Narrow with wrap off: a long command keeps one line and scrolls inside the plate; the copy button stays on the same line. */
export const NarrowLongCommand: Story = { ...phone, args: { label: 'Add the MCP server', code: MCP_COMMAND, wrap: false } };
/** Narrow and wrapped: the command breaks anywhere, the copy button stays at the top right. */
export const NarrowWrapped: Story = { ...phone, args: { label: 'Add the MCP server', code: MCP_COMMAND, wrap: true } };

type Row = 'short' | 'long' | 'wrap' | 'readonly';

export const AllStates: Story = {
  decorators: [(Story) => <Story />],
  render: () => (
    <SpecimenStack>
      <StateGrid<Row>
        columns={[{ label: 'Default' }, { label: 'Hover', pseudo: 'hover' }, { label: 'Focus visible', pseudo: 'focus-visible' }, { label: 'Active', pseudo: 'active' }]}
        rows={[
          { label: 'Short command', value: 'short' },
          { label: 'Long, scrolls', value: 'long' },
          { label: 'Long, wraps', value: 'wrap' },
          { label: 'No copy button', value: 'readonly' },
        ]}
        render={(row) => (
          <div style={{ width: 280 }}>
            <CodeBlock label="Install" code={row === 'short' ? 'npm install @bridge-ds/react' : MCP_COMMAND} wrap={row !== 'long'} hideCopy={row === 'readonly'} />
          </div>
        )}
      />
      <Specimen label="Multi-line, no label">
        <div style={{ width: 400 }}>
          <CodeBlock code={"import { Button } from '@bridge-ds/react';\nimport '@bridge-ds/react/styles.css';"} />
        </div>
      </Specimen>
      <Specimen label="Custom button text">
        <div style={{ width: 400 }}>
          <CodeBlock label="Token name" code="color.action.primary.bg" copyLabel="Copy name" copiedLabel="Name copied" />
        </div>
      </Specimen>
    </SpecimenStack>
  ),
};
