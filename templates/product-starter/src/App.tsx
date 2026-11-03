import { Button, Card, Stack } from '@bridge-ds/react';

/** The first screen. Replace it with your product: build with the library's components and tokens only. */
export function App() {
  return (
    <main style={{ maxWidth: 'var(--size-160)', margin: '0 auto', padding: 'var(--space-8)' }}>
      <Card>
        <Stack gap="4">
          <h1 style={{ margin: 0, fontFamily: 'var(--typography-display-family)' }}>Your new product</h1>
          <p style={{ margin: 0 }}>Built with your team's library. Start an exploration from Bridge to shape this screen.</p>
          <div>
            <Button variant="primary">Get started</Button>
          </div>
        </Stack>
      </Card>
    </main>
  );
}
