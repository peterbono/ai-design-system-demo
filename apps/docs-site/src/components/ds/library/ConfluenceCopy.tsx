// "Copy for Confluence" in a Library page header: copies the page as Confluence-ready HTML with a Markdown fallback
// (scripts/confluence-copy.ts reads /confluence/<page>.json, built from lib/library/confluence/). Bridge's own Library
// only: a team's Library is read in the browser and has no built copy yet.
import { createElement, useEffect } from 'react';
import { Button, ToastProvider, useToast, type UseToastReturn } from '@bridge-ds/react';
import { ClipboardCopy } from 'lucide-react';
import { confluenceSrc } from '../../../lib/library/confluence/render';
import type { LibraryData } from './library-data';

export function ConfluenceCopy({ data, route }: { data: Pick<LibraryData, 'team'>; route: string }) {
  if (data.team) return null;
  return (
    <Button variant="secondary" size="sm" iconStart={ClipboardCopy} data-confluence-copy="" data-confluence-src={confluenceSrc(route)}>
      Copy for Confluence
    </Button>
  );
}

/** The toasts of the copy, mounted on the first click (a static page has no React root of its own). */
export function ConfluenceToasts({ onReady }: { onReady: (api: UseToastReturn) => void }) {
  return createElement(ToastProvider, { limit: 1 }, createElement(ToastReady, { onReady }));
}

function ToastReady({ onReady }: { onReady: (api: UseToastReturn) => void }) {
  const api = useToast();
  useEffect(() => onReady(api), [api, onReady]);
  return null;
}
