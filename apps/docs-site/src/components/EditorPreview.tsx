// Component samples for Studio Tokens previews (the value popover and the draft review): real @bridge-ds/react
// components, rendered to static HTML at build time, one sample per component (data-sample="<Name>"). A few are
// written here for a compact frame; every other component brings its Library preview (docs.json "preview"), so any
// component that uses a token can be shown. scripts/explorer/preview-frames.ts clones them into frames and paints
// the draft as CSS variable overrides, so the preview repaints without React.
import Example from './Example';
import type { ExampleNode } from '../lib/components';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Checkbox,
  Input,
  Kbd,
  Link,
  Progress,
  Switch,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsList,
  Tag,
} from '@bridge-ds/react';

const OWN = ['Card', 'Table', 'Button', 'Input', 'Alert', 'Badge', 'Tabs', 'Checkbox', 'Switch', 'Tag', 'Link', 'Progress', 'Avatar', 'Kbd'];

export default function EditorPreview({ previews = [] }: { previews?: { name: string; node: ExampleNode }[] }) {
  return (
    <div className="xe-samples">
      {previews
        .filter((p) => !OWN.includes(p.name))
        .map((p) => (
          <div key={p.name} data-sample={p.name}>
            <Example node={p.node} />
          </div>
        ))}
      <div data-sample="Card">
        <Card>
          <CardHeader>Release 0.2</CardHeader>
          <CardBody>Packages publish under the @bridge-ds scope.</CardBody>
          <CardFooter>
            <Button size="sm">Open</Button>
          </CardFooter>
        </Card>
      </div>
      <div data-sample="Table">
        <Table aria-label="Sample table">
          <TableHeader>
            <TableRow>
              <TableHead>Token</TableHead>
              <TableHead>Light</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>bg.subtle</TableCell>
              <TableCell>#edeff2</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>bg.muted</TableCell>
              <TableCell>#e3e8ee</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
      <div data-sample="Button">
        <Button size="sm">Publish</Button> <Button size="sm" variant="secondary">Save draft</Button>
      </div>
      <div data-sample="Input">
        <Input label="Release name" defaultValue="Spring refresh" />
      </div>
      <div data-sample="Alert">
        <Alert tone="warning" title="2 tokens need review" announce="off">
          Contrast drops on muted text.
        </Alert>
      </div>
      <div data-sample="Badge">
        <Badge tone="success">Ready</Badge> <Badge tone="danger">Failing</Badge> <Badge>Draft</Badge>
      </div>
      <div data-sample="Tabs">
        <Tabs defaultValue="tokens">
          <TabsList aria-label="Sample tabs">
            <Tab value="tokens">Tokens</Tab>
            <Tab value="history">History</Tab>
          </TabsList>
        </Tabs>
      </div>
      <div data-sample="Checkbox">
        <Checkbox label="Notify reviewers" defaultChecked />
      </div>
      <div data-sample="Switch">
        <Switch label="Compact rows" defaultChecked />
      </div>
      <div data-sample="Tag">
        <Tag>tokens</Tag> <Tag>tier-3</Tag>
      </div>
      <div data-sample="Link">
        <Link href="#preview">Read the release notes</Link>
      </div>
      <div data-sample="Progress">
        <Progress value={60} label="Checks" />
      </div>
      <div data-sample="Avatar">
        <Avatar name="Florian Gouloubi" />
      </div>
      <div data-sample="Kbd">
        <Kbd keys="Enter" />
      </div>
    </div>
  );
}
