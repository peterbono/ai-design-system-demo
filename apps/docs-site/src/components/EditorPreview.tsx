// Visual preview of the token review sheet: real @bridge-ds/react components, rendered to static HTML at build time,
// one sample per component (data-sample="<Name>"). scripts/explorer/review.ts clones the samples of the components
// that use the edited token into before and after frames, and paints the draft as CSS variable overrides on the
// after frame, so the preview repaints without React.
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

export default function EditorPreview() {
  return (
    <div className="xe-samples">
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
