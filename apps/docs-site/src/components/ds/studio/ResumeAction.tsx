// Back from GitHub (a sign-in, or Add a product's Install on GitHub; scripts/pending-action.ts): mounted once in the
// Studio shell, wherever the person lands. Add a product (new or already built) reopens here at the step they were on,
// with what they typed and "Back from GitHub. Create Atlas now?", the primary button focused; nothing is sent before
// they click. The other dialogs (Start an exploration, a product's rename and removal, a new brand) take their own
// action when they mount; what none of them takes after a few seconds, and any other save, gets one short notice.
import { lazy, Suspense, useEffect, useState } from 'react';
import { ToastProvider, useToast } from '@bridge-ds/react';
import type { Resume } from '../../../scripts/resume';
import type { AddProductResume } from './AddProduct';

const AddProduct = lazy(() => import('./AddProduct'));

/** Dialogs that take their own action on mount get this long before the shell says it instead. */
export const UNCLAIMED_MS = 10_000;

export default function ResumeAction() {
  const [adding, setAdding] = useState<AddProductResume | null>(null);
  const [notice, setNotice] = useState<Resume | null>(null);

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void (async () => {
      const { peekPendingAction } = await import('../../../scripts/pending-action');
      const first = peekPendingAction();
      if (!first || !live) return;
      const { takeResume } = await import('../../../scripts/resume');
      if (first.kind === 'new-product' || first.kind === 'add-product') {
        const r = takeResume(first.kind);
        if (r && live) setAdding({ kind: first.kind, values: r.action.values, line: r.line });
        return;
      }
      if (first.kind === 'retry') {
        const r = takeResume('retry');
        if (r && live) setNotice(r);
        return;
      }
      // Its own dialog takes it when it mounts; still here later, the shell says it.
      timer = setTimeout(() => {
        const r = takeResume(null);
        if (r && live) setNotice(r);
      }, UNCLAIMED_MS);
    })().catch(() => undefined);
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return (
    <>
      {adding && (
        <Suspense fallback={null}>
          <AddProduct open resume={adding} onOpenChange={(o) => !o && setAdding(null)} />
        </Suspense>
      )}
      {notice && (
        <ToastProvider>
          <ResumeNotice resume={notice} />
        </ToastProvider>
      )}
    </>
  );
}

/** One short notice: signed in (do it again), or not ("Sign in again to finish."). */
function ResumeNotice({ resume }: { resume: Resume }) {
  const toast = useToast();
  useEffect(() => {
    toast.add({ title: resume.ok ? 'Ready to save' : 'Not saved yet', description: resume.line, tone: resume.ok ? 'success' : 'warning', timeout: 10_000 });
    // Once per notice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resume]);
  return null;
}
