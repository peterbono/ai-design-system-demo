import { Button, Card, Input } from '@bridge-ds/react';
import styles from './page.module.css';

export function Page() {
  return (
    <Card className={styles.root}>
      <Input aria-label="Name" />
      <Button style={{ marginTop: 'var(--space-4)' }}>Save</Button>
    </Card>
  );
}
