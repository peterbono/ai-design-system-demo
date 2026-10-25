// Settings, Claude, below the connector card: the measure of the team's components, which lets Claude fix what differs
// in Figma. One row, one sentence for everyone:
//   "Bridge measured your components on Oct 25, 2026. Claude uses it to fix what differs in Figma."
//   "Bridge hasn't measured your components yet. A developer turns it on once: Set up automatic measure."
// The "For developers" fold holds the one action, Set up automatic measure (a pull request that adds the workflow),
// what it does, and the facts. When GitHub does not let Bridge write a workflow, the fold says so and gives the file:
// Open on GitHub (filled in when it fits the address) and Copy the workflow. The sample team reads nothing.
// Words: lib/measure-setting.ts; GitHub: scripts/measure-setup.ts.
import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button, Card, CardBody, Link } from '@bridge-ds/react';
import { MEASURE_BRANCH, MEASURE_WORKFLOW_FILE } from '@bridge-ds/core';
import { useCopy } from './TeamLink';
import { NoticeLine } from './MemberParts';
import { Code, DevFold } from './SettingsParts';
import type { Notice } from './members-state';
import { isWorkflowRefusal, MEASURE_WORDS as W, measureSentence, newWorkflowUrl, type MeasureState } from '../../../lib/measure-setting';
import type { AccessContext } from '../../../lib/library-access';
import { readRepo } from '../../../scripts/github-session';

export default function MeasureSetting({ context }: { context: AccessContext }) {
  const [state, setState] = useState<MeasureState | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [manual, setManual] = useState<{ yaml: string; url: string; filled: boolean } | null>(null);
  const { copied, said, copy } = useCopy();

  useEffect(() => {
    if (context !== 'real') return;
    let live = true;
    void import('../../../scripts/measure-setup')
      .then((m) => m.readMeasureState())
      .then(
        (s) => live && setState(s),
        () => live && setState({ kind: 'unknown' }),
      );
    return () => {
      live = false;
    };
  }, [context]);

  const setUp = async () => {
    setNotice(null);
    setBusy(true);
    const m = await import('../../../scripts/measure-setup');
    try {
      const pr = await m.openMeasureSetup();
      setNotice({ tone: 'success', text: W.sent, link: { label: `Pull request #${pr.number}`, href: pr.url } });
    } catch (e) {
      if (e instanceof Error && e.message === 'signin') setNotice({ tone: 'info', text: W.signIn });
      else if (isWorkflowRefusal(e)) {
        const { yaml } = await m.measureWorkflowForTeam();
        setManual({ yaml, ...newWorkflowUrl(readRepo(), yaml) });
        setNotice({ tone: 'info', text: W.needsGitHub });
      } else setNotice({ tone: 'danger', text: e instanceof Error && e.message ? e.message : 'Something went wrong. Try again in a minute.' });
    } finally {
      setBusy(false);
    }
  };

  const sentence = context === 'sample' ? W.sample : state ? measureSentence(state) : W.checking;
  const offer = context === 'real' && state !== null && state.kind !== 'measured';
  return (
    <Card id="measure">
      <CardBody>
        <div className="set-rows">
          <div className="set-row">
            <p className="set-row-label">{W.label}</p>
            <div className="set-row-value">
              <p role="status">{sentence}</p>
            </div>
          </div>
        </div>
        <DevFold
          facts={[
            { term: 'Workflow', value: MEASURE_WORKFLOW_FILE, code: true },
            { term: 'Publishes to', value: <><Code>measured-specs.json</Code>, <Code>measured-shots/</Code> on <Code>{MEASURE_BRANCH}</Code></> },
            { term: 'Token', value: "The run's GITHUB_TOKEN (contents: write). No secret." },
            { term: 'From a terminal', value: 'npx @bridge-ds/cli measure setup', code: true },
          ]}
        >
          <p className="set-row-help">{W.what}</p>
          {offer && (
            <p className="set-connection">
              <Button variant="secondary" data-density="compact" loading={busy} disabled={busy} onClick={() => void setUp()}>
                {busy ? W.busy : W.action}
              </Button>
            </p>
          )}
          <NoticeLine notice={notice} />
          {manual && (
            <p className="set-connection">
              <Link href={manual.url} external>
                {W.openOnGitHub}
              </Link>
              <Button variant="ghost" data-density="compact" iconStart={copied ? Check : Copy} onClick={() => void copy(manual.yaml, W.copied)}>
                {copied ? W.copied : W.copy}
              </Button>
              <span className="sr-only" role="status" aria-live="polite">
                {said}
              </span>
            </p>
          )}
        </DevFold>
      </CardBody>
    </Card>
  );
}
