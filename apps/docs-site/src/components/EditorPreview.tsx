// Live preview for the token editor: real components from @demo-ds/react, rendered to static HTML at build time.
// The editor sets the draft as CSS variable overrides on each frame, so the preview repaints without React.
import { Alert, Badge, Button, Card, CardBody, CardFooter, CardHeader, Input, Tab, Tabs, TabsList, TabsPanel } from '@demo-ds/react';

export default function EditorPreview({ theme }: { theme: 'light' | 'dark' }) {
  return (
    <div className="ed-sample">
      <Tabs defaultValue="tokens">
        <TabsList aria-label={`Sample tabs, ${theme}`}>
          <Tab value="tokens" count={12}>
            Tokens
          </Tab>
          <Tab value="history">History</Tab>
        </TabsList>
        <TabsPanel value="tokens">
          <Card>
            <CardHeader>
              Release 1.4 <Badge tone="success">Ready</Badge>
            </CardHeader>
            <CardBody>
              <Input label="Release name" defaultValue="Spring refresh" hint="Shown in the changelog." />
            </CardBody>
            <CardFooter>
              <Button variant="ghost" size="sm">
                Preview
              </Button>
              <Button variant="secondary" size="sm">
                Save draft
              </Button>
              <Button size="sm">Publish</Button>
            </CardFooter>
          </Card>
          <Alert tone="warning" title="2 tokens need review" announce="off">
            Contrast drops below 4.5:1 on muted text.
          </Alert>
        </TabsPanel>
      </Tabs>
    </div>
  );
}
