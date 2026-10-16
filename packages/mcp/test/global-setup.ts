import { readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Test repos are created in workers; remove them once the whole run is over.
export default function setup() {
  return () => {
    for (const d of readdirSync(tmpdir())) if (d.startsWith('bridge-test-')) rmSync(join(tmpdir(), d), { recursive: true, force: true });
  };
}
