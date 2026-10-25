// The automatic measure workflow: one generator (measureWorkflowYaml) for the CLI's `bridge measure setup`, Studio's
// "Set up automatic measure", templates/bridge-measure.yml and this repository's own copy. The two files in the repo
// must equal the generator's output: after changing it, run
//   BRIDGE_UPDATE_WORKFLOWS=1 npx vitest run --project core packages/core/test/measure-workflow.test.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MEASURE_CLI_PACKAGE, measureWorkflowYaml, type MeasureWorkflowOptions } from '../src/measure-workflow';

const ROOT = join(__dirname, '../../..');

/** This repository: its deployed Storybook on Vercel, its own build of the CLI. */
const BRIDGE: MeasureWorkflowOptions = {
  defaultBranch: 'main',
  storybookUrl: 'https://bridge-storybook.floriangouloubi.com',
  deployName: 'bridge-storybook',
  node: 'file:.nvmrc',
  prepare: 'npm run tokens:build && npm run mcp:build',
  cli: 'node packages/cli/dist/index.js',
  paths: ['packages/react/src/**', 'packages/tokens/src/**', '.storybook/**'],
  header: `# Bridge measure: this repository's own copy of templates/bridge-measure.yml (other teams: copy the template, or run
# \`npx @bridge-ds/cli measure setup\`). Same generator (measureWorkflowYaml in @bridge-ds/core), with the local build of
# the CLI and the production Storybook on Vercel (bridge-storybook.floriangouloubi.com): it measures after each deploy
# of it from main that changes the components, tokens or Storybook config, on Mondays, and by hand. It publishes
# measured-specs.json and measured-shots/ to the bridge-requests branch, where the Claude fix tools, the Figma plugin
# and Studio read them, only when the measure changed. Token: the run's GITHUB_TOKEN (contents: write), no secret.
# Docs: docs/MEASURE.md. Do not edit by hand: change the generator and re-render (packages/core/test/measure-workflow.test.ts).`,
};

const files: [string, MeasureWorkflowOptions | undefined][] = [
  ['templates/bridge-measure.yml', undefined],
  ['.github/workflows/bridge-measure.yml', BRIDGE],
];

describe('the files in the repo', () => {
  for (const [path, options] of files) {
    it(`${path} is the generator's output`, () => {
      const yaml = measureWorkflowYaml(options);
      if (process.env.BRIDGE_UPDATE_WORKFLOWS) writeFileSync(join(ROOT, path), yaml);
      expect(readFileSync(join(ROOT, path), 'utf8')).toBe(yaml);
    });
  }
});

describe('measureWorkflowYaml', () => {
  it('built here (no Storybook address): builds and serves Storybook, runs on pushes that change it', () => {
    const y = measureWorkflowYaml({ defaultBranch: 'develop', paths: ['src/**'], buildCommand: 'pnpm build-storybook', storybookDir: 'dist/sb' });
    expect(y).toMatch(/^on:\n  push:\n    branches: \[develop\]\n    # .*\n    paths:\n      - 'src\/\*\*'\n  schedule:/m);
    expect(y).not.toMatch(/^  status:/m);
    expect(y).toMatch(/run: pnpm build-storybook/);
    expect(y).toMatch(/--directory 'dist\/sb'/);
    expect(y).toContain("STORYBOOK_URL: 'http://127.0.0.1:6006'");
    expect(y).toContain(`npx --yes ${MEASURE_CLI_PACKAGE} specs --measure --storybook "$STORYBOOK_URL" --variants --states rest,hover,active,disabled --tokens --shots --check`);
    expect(y).not.toMatch(/steps\.changed/);
  });

  it('deployed Storybook: follows its deploy from the default branch, skips deploys that do not change it', () => {
    const y = measureWorkflowYaml({ storybookUrl: 'https://sb.acme.dev/', deployName: 'Storybook' });
    expect(y).toMatch(/^  status:\n  deployment_status:\n  schedule:/m);
    expect(y).not.toMatch(/^  push:/m);
    expect(y).toContain("contains(github.event.context, 'storybook')");
    expect(y).toContain('contains(github.event.branches.*.name, github.event.repository.default_branch)');
    expect(y).toContain("!contains(github.event.deployment.environment, 'preview')");
    expect(y).toContain("STORYBOOK_URL: 'https://sb.acme.dev'");
    expect(y).not.toMatch(/Build Storybook/);
    // Every step after the guard waits for it.
    const guarded = y.split('\n').filter((l) => l.includes("if: steps.changed.outputs.skip != 'true'")).length;
    expect(guarded).toBe(4);
  });

  it('publishes to bridge-requests only when the measure changed, with the run token only', () => {
    const y = measureWorkflowYaml();
    expect(y).toMatch(/permissions:\n  contents: write # push to the bridge-requests branch only\n\n/);
    expect(y).toContain('MEASURE_BRANCH: bridge-requests');
    expect(y).toContain('"The measure did not change: nothing to publish."');
    expect(y).toContain('delete j.measuredAt;delete j.createdAt');
    expect(y).toContain('git push -q origin "HEAD:refs/heads/$MEASURE_BRANCH"');
    expect(y).not.toMatch(/refs\/heads\/main|push origin main/);
    // The only secret named is the optional registry token.
    expect([...y.matchAll(/secrets\.(\w+)/g)].map((m) => m[1])).toEqual(['NPM_TOKEN']);
    expect(y).not.toMatch(/—/);
  });

  it('a single quote in a value stays valid YAML', () => {
    expect(measureWorkflowYaml({ storybookDir: "it's" })).toContain("--directory 'it''s'");
  });
});
