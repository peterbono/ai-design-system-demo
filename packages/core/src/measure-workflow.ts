// The automatic measure: a GitHub Actions workflow that measures the team's Storybook each time it changes
// (`bridge specs --measure`, headless Chrome in CI) and publishes measured-specs.json and measured-shots/ to the
// measure branch (measure-location.ts), only when the measure changed. The Claude fix tools, the Figma plugin and Studio
// read it there. One generator for every place that writes the workflow: `bridge measure setup` (CLI), Studio Settings
// ("Set up automatic measure", a pull request), templates/bridge-measure.yml and this repository's own copy.
//
// Pure and browser safe: a string in, a string out.

import { DEFAULT_MEASURED_SPECS_FILE } from './figma-fix-run';
import { MEASURE_BRANCH, MEASURE_WORKFLOW_FILE, MEASURED_SHOTS_DIR } from './measure-location';

/** The published CLI the template runs: the first version with every measure flag the workflow passes. */
export const MEASURE_CLI_PACKAGE = '@bridge-ds/cli@^0.13.0';
/** What the measure reads in each story: every variant, in these states, the variables, a shot of each. */
export const MEASURE_FLAGS = '--variants --states rest,hover,active,disabled --tokens --shots --check';
/** Files whose change can change what the Storybook draws, when nothing more precise is known. */
export const MEASURE_DEFAULT_PATHS = ['src/**', 'packages/**', '.storybook/**', 'package.json', 'package-lock.json'];

export interface MeasureWorkflowOptions {
  /** The default branch (bridge.config.json repo.defaultBranch). Default main. */
  defaultBranch?: string | undefined;
  /**
   * The deployed Storybook (bridge.config.json previews.production.storybook). Set: the workflow measures it once a
   * deploy of it succeeds. Empty: it builds Storybook in the run and measures that build (any Storybook, private ones too).
   */
  storybookUrl?: string | undefined;
  /**
   * Deployed Storybook only: a word of the deploy's status or environment name ("Vercel – bridge-storybook"), so the
   * measure follows the Storybook deploy, not another app's. Default "storybook".
   */
  deployName?: string | undefined;
  /** Install command. Default `npm ci`. */
  install?: string | undefined;
  /** Built Storybook only: the build command and its output folder. Default `npm run build-storybook`, storybook-static. */
  buildCommand?: string | undefined;
  storybookDir?: string | undefined;
  /** What changes the Storybook (a push touching these measures again). Default MEASURE_DEFAULT_PATHS. */
  paths?: readonly string[] | undefined;
  /**
   * The CLI command. Default `npx --yes <MEASURE_CLI_PACKAGE>`. This repository runs its own build
   * (`node packages/cli/dist/index.js`), with `prepare` building it.
   */
  cli?: string | undefined;
  /** Commands run after the install, before the measure (this repository builds the CLI). */
  prepare?: string | undefined;
  /** Node: a version, or `file:<path>` for node-version-file. Default 20. */
  node?: string | undefined;
  /** The header comment. Default: the template's, for teams. */
  header?: string | undefined;
}

/**
 * The options a team's bridge.config.json gives (parsed JSON, any shape): its default branch, its deployed Storybook
 * (previews.production.storybook) and what changes the Storybook (the folder of its components, its tokens, the
 * Storybook config). Missing parts are left to the defaults.
 */
export function measureWorkflowOptionsFromConfig(config: unknown): MeasureWorkflowOptions {
  const c = (config && typeof config === 'object' ? config : {}) as {
    repo?: { defaultBranch?: unknown };
    previews?: { production?: { storybook?: unknown } };
    components?: { dir?: unknown };
    tokens?: { root?: unknown };
  };
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const storybook = str(c.previews?.production?.storybook);
  const dir = str(c.components?.dir)?.replace(/^\.?\/+|\/+$/g, '');
  const tokens = str(c.tokens?.root)?.replace(/^\.?\/+|\/+$/g, '');
  // The components' source folder (their parent: stories and shared styles sit next to them), and the tokens.
  const source = dir ? (dir.includes('/') ? dir.replace(/\/[^/]*$/, '') : dir) : undefined;
  const paths = [...new Set([...(source ? [`${source}/**`] : []), ...(tokens ? [`${tokens}/**`] : []), '.storybook/**', 'package.json', 'package-lock.json'])];
  return {
    ...(str(c.repo?.defaultBranch) ? { defaultBranch: str(c.repo?.defaultBranch) } : {}),
    ...(storybook && /^https:\/\//.test(storybook) ? { storybookUrl: storybook } : {}),
    ...(source || tokens ? { paths } : {}),
  };
}

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** The comment teams read at the top of the file: what it does, when, with which token, and the optional secret. */
export const MEASURE_WORKFLOW_HEADER = `# Bridge measure: keeps the measure of your components fresh, so Claude can fix what differs in Figma.
# Copy it to ${MEASURE_WORKFLOW_FILE} in your design system repository, or let Bridge add it: Studio, Settings,
# For developers, Set up automatic measure (a pull request), or \`npx @bridge-ds/cli measure setup\`.
#
# It measures what your Storybook really draws (\`bridge specs --measure\`, headless Chrome): every variant at rest, on
# hover, pressed and disabled, the CSS variables behind each value, and a screenshot of each. It publishes
# ${DEFAULT_MEASURED_SPECS_FILE} and ${MEASURED_SHOTS_DIR}/ to the \`${MEASURE_BRANCH}\` branch, next to figma-fidelity.json (the Figma plugin's
# Compare with code). The Claude fix tools, the Figma plugin ("Ask Claude to fix it") and Studio read it there.
# It commits only when the measure changed.
#
# When: after each deploy of your Storybook (deployed Storybook), or on each push to the default branch that changes it
# (built here), every Monday as a fallback, and by hand (Actions, Bridge measure, Run workflow).
#
# Token: only the GITHUB_TOKEN of this run, with \`contents: write\` to push the \`${MEASURE_BRANCH}\` branch. Your
# default branch is never written. No secret to add.
# A Storybook behind a login: set it up without an address (\`npx @bridge-ds/cli measure setup --build\`), the run then
# builds Storybook itself. If installing needs a private registry, add an NPM_TOKEN repository secret (optional); the
# install step passes it as NODE_AUTH_TOKEN.
# Docs: https://bridge.floriangouloubi.com/docs/automatic-measure/`;

/** The workflow YAML. */
export function measureWorkflowYaml(o: MeasureWorkflowOptions = {}): string {
  const branch = o.defaultBranch?.trim() || 'main';
  const url = o.storybookUrl?.trim().replace(/\/+$/, '') ?? '';
  const deployed = Boolean(url);
  const deployName = (o.deployName?.trim() || 'storybook').toLowerCase();
  const paths = o.paths?.length ? o.paths : MEASURE_DEFAULT_PATHS;
  const install = o.install?.trim() || 'npm ci';
  const build = o.buildCommand?.trim() || 'npm run build-storybook';
  const dir = o.storybookDir?.trim().replace(/\/+$/, '') || 'storybook-static';
  const cli = o.cli?.trim() || `npx --yes ${MEASURE_CLI_PACKAGE}`;
  const node = o.node?.trim() || '20';
  const nodeLine = node.startsWith('file:') ? `node-version-file: ${node.slice(5)}` : `node-version: ${q(node)}`;
  const pathList = paths.map((p) => `      - ${q(p)}`).join('\n');

  // A deploy event names its app in the status context (Vercel, Netlify) or the deployment's environment.
  const deployIf = `(github.event_name == 'status' && github.event.state == 'success' && contains(github.event.branches.*.name, github.event.repository.default_branch) && contains(github.event.context, ${q(deployName)})) || (github.event_name == 'deployment_status' && github.event.deployment_status.state == 'success' && contains(github.event.deployment.environment, ${q(deployName)}) && !contains(github.event.deployment.environment, 'preview'))`;
  const triggers = deployed
    ? `on:
  # After each successful deploy of the Storybook from the default branch (Vercel and Netlify report it as a commit
  # status, others as a GitHub deployment).
  status:
  deployment_status:
  schedule:
    - cron: '17 5 * * 1' # Mondays, a fallback
  workflow_dispatch:`
    : `on:
  push:
    branches: [${branch}]
    # What changes the Storybook: a push touching these measures again.
    paths:
${pathList}
  schedule:
    - cron: '17 5 * * 1' # Mondays, a fallback
  workflow_dispatch:`;

  const jobIf = deployed
    ? `    # A manual run from another branch would measure another branch. A deploy: the Storybook's, from the default branch.
    if: >-
      (github.event_name == 'schedule')
      || (github.event_name == 'workflow_dispatch' && github.ref_name == github.event.repository.default_branch)
      || ${deployIf}`
    : `    # A manual run from another branch would measure another branch.
    if: github.event_name != 'workflow_dispatch' || github.ref_name == github.event.repository.default_branch`;

  const changedGuard = deployed
    ? `
      # A deploy runs on every change to the default branch: measure only when this one can change the Storybook.
      - name: Did the Storybook change?
        id: changed
        run: |
          if [ "$GITHUB_EVENT_NAME" = "status" ] || [ "$GITHUB_EVENT_NAME" = "deployment_status" ]; then
            if git rev-parse -q --verify HEAD^ > /dev/null && git diff --quiet HEAD^ HEAD -- ${paths.map(q).join(' ')}; then
              echo "Nothing that changes the Storybook in this deploy: the measure stays as it is."
              echo "skip=true" >> "$GITHUB_OUTPUT"
            fi
          fi
`
    : '';
  // Deployed: every step after the guard runs only when the deploy can change the Storybook.
  const whenStep = (s: string) => (deployed ? s.replace(/^( {6}- name: .*\n)/, `$1        if: steps.changed.outputs.skip != 'true'\n`) : s);

  const storybookSteps = deployed
    ? ''
    : whenStep(`      - name: Build Storybook
        run: ${build}

      - name: Serve the build
        run: |
          python3 -m http.server 6006 --bind 127.0.0.1 --directory ${q(dir)} > /dev/null 2>&1 &
          for i in $(seq 1 30); do curl -sf http://127.0.0.1:6006/index.json > /dev/null && exit 0; sleep 1; done
          echo "Storybook did not answer on http://127.0.0.1:6006 (is ${dir} the build folder?)"; exit 1

`);
  const storybook = deployed ? url : 'http://127.0.0.1:6006';

  const steps = `      - uses: actions/checkout@v4
        with:
          # A deploy status names its commit; other events run on the default branch head.
          ref: \${{ github.event.sha || github.sha }}
          fetch-depth: 2
${changedGuard}
${whenStep(`      - name: Set up Node
        uses: actions/setup-node@v4
        with:
          ${nodeLine}
          cache: npm
`)}
${whenStep(`      - name: Install
        env:
          NODE_AUTH_TOKEN: \${{ secrets.NPM_TOKEN }}
        run: ${install}
`)}${o.prepare ? `\n${whenStep(`      - name: Prepare
        run: ${o.prepare}
`)}` : ''}
${storybookSteps}${whenStep(`      - name: Measure the Storybook
        env:
          # ubuntu-latest ships Google Chrome; the measure drives it headless, no browser download.
          BRIDGE_CHROME_CHANNEL: chrome
        run: |
          set -o pipefail
          ${cli} specs --measure --storybook "$STORYBOOK_URL" ${MEASURE_FLAGS} --out "$RUNNER_TEMP/bridge-measure/${DEFAULT_MEASURED_SPECS_FILE}" | tail -n 40 | tee -a "$GITHUB_STEP_SUMMARY"
`)}
${whenStep(`      - name: Publish to the ${MEASURE_BRANCH} branch, if the measure changed
        env:
          OUT: \${{ runner.temp }}/bridge-measure
        run: |
          set -euo pipefail
          git config --global user.name "github-actions[bot]"
          git config --global user.email "41898282+github-actions[bot]@users.noreply.github.com"
          dir="$RUNNER_TEMP/measure-branch"
          if git ls-remote --exit-code --heads origin "$MEASURE_BRANCH" > /dev/null; then
            git fetch -q --depth 1 origin "$MEASURE_BRANCH"
            git worktree add -q --detach "$dir" FETCH_HEAD
          else
            # Like the Figma plugin: the requests branch starts from the default branch.
            git worktree add -q --detach "$dir" HEAD
          fi
          # The same measure at another time is not a change: compare without the timestamps.
          same() { node -e 'const f=require("fs");const r=(p)=>{try{const j=JSON.parse(f.readFileSync(p,"utf8"));delete j.measuredAt;delete j.createdAt;return JSON.stringify(j)}catch{return null}};const a=r(process.argv[1]);process.exit(a!==null&&a===r(process.argv[2])?0:1)' "$1" "$2"; }
          if same "$dir/${DEFAULT_MEASURED_SPECS_FILE}" "$OUT/${DEFAULT_MEASURED_SPECS_FILE}" && { [ ! -f "$OUT/${MEASURED_SHOTS_DIR}/manifest.json" ] || same "$dir/${MEASURED_SHOTS_DIR}/manifest.json" "$OUT/${MEASURED_SHOTS_DIR}/manifest.json"; }; then
            echo "The measure did not change: nothing to publish." | tee -a "$GITHUB_STEP_SUMMARY"
            exit 0
          fi
          rm -rf "$dir/${DEFAULT_MEASURED_SPECS_FILE}" "$dir/${MEASURED_SHOTS_DIR}"
          cp "$OUT/${DEFAULT_MEASURED_SPECS_FILE}" "$dir/"
          if [ -d "$OUT/${MEASURED_SHOTS_DIR}" ]; then cp -R "$OUT/${MEASURED_SHOTS_DIR}" "$dir/"; fi
          cd "$dir"
          git add -A
          git commit -qm "bridge measure: \${GITHUB_SHA:0:7}"
          # The Figma plugin writes to this branch too: on a race, rebase and retry.
          for i in 1 2 3 4; do
            if git push -q origin "HEAD:refs/heads/$MEASURE_BRANCH"; then echo "Published to $MEASURE_BRANCH." | tee -a "$GITHUB_STEP_SUMMARY"; exit 0; fi
            sleep $((i * 3))
            git fetch -q --depth 20 origin "$MEASURE_BRANCH" && git rebase -q FETCH_HEAD
          done
          exit 1
`)}`;

  return `${o.header ?? MEASURE_WORKFLOW_HEADER}

name: Bridge measure

${triggers}

concurrency:
  # One measure at a time; a newer one replaces a waiting one.
  group: bridge-measure
  cancel-in-progress: false

permissions:
  contents: write # push to the ${MEASURE_BRANCH} branch only

env:
  MEASURE_BRANCH: ${MEASURE_BRANCH}
  # ${deployed ? 'The deployed Storybook the measure reads.' : 'Storybook as this run builds and serves it (below).'}
  STORYBOOK_URL: ${q(storybook)}

jobs:
  measure:
    name: Measure the Storybook
${jobIf}
    runs-on: ubuntu-latest
    timeout-minutes: 120
    steps:
${steps.replace(/\n{3,}/g, '\n\n').replace(/\n+$/, '')}
`;
}
