import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Button } from '../Button';
import { Checkbox } from '../Checkbox';
import { Field } from '../Field';
import { Input } from '../Input';
import { Radio, RadioGroup } from '../RadioGroup';
import { Switch } from '../Switch';
import { Textarea } from '../Textarea';
import { Form, FormActions, type FormErrors } from './Form';

const meta = {
  title: 'Forms/Form',
  component: Form,
  decorators: [(S) => <div style={{ maxWidth: 480 }}><S /></div>],
} satisfies Meta<typeof Form>;

export default meta;
type Story = StoryObj<typeof meta>;

function ConnectRepository({ initialErrors }: { initialErrors?: FormErrors }) {
  const [errors, setErrors] = useState<FormErrors | undefined>(initialErrors);
  const [loading, setLoading] = useState(false);
  return (
    <Form
      errors={errors}
      onFormSubmit={(values) => {
        setLoading(true);
        setTimeout(() => {
          setLoading(false);
          setErrors(values.repository === 'acme/design-tokens' ? {} : { repository: 'Repository not found. Check the owner and the name.' });
        }, 600);
      }}
    >
      <Field label="Repository" name="repository" required description="Owner and name, like acme/design-tokens.">
        <Input placeholder="acme/design-tokens" />
      </Field>
      <Field label="Token folder" name="path" description="Where the DTCG files live in the repository.">
        <Input defaultValue="packages/tokens/src" />
      </Field>
      <Textarea label="Note for reviewers" name="note" rows={2} />
      <RadioGroup label="Merge strategy" name="strategy" defaultValue="squash" orientation="horizontal">
        <Radio value="squash" label="Squash" />
        <Radio value="merge" label="Merge commit" />
      </RadioGroup>
      <Switch name="autopublish" label="Auto-publish after two approvals" />
      <Checkbox name="terms" label="Open a draft pull request first" defaultChecked />
      <FormActions>
        <Button variant="ghost" type="reset">Cancel</Button>
        <Button type="submit" loading={loading}>{loading ? 'Connecting' : 'Connect repository'}</Button>
      </FormActions>
    </Form>
  );
}

export const Default: Story = { render: () => <ConnectRepository /> };

export const ServerErrors: Story = {
  render: () => (
    <ConnectRepository
      initialErrors={{
        repository: 'Repository not found. Check the owner and the name.',
        path: 'No .tokens.json files in this folder. Pick the folder that holds your token sources.',
      }}
    />
  ),
};

export const AllStates: Story = ServerErrors;
