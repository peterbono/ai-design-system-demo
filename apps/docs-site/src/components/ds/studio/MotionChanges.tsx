// "Motion changes" for a branch review: one plain sentence per change ("Popups open faster: motion.duration.moderate
// goes from 200 ms to 150 ms"), two looping previews side by side playing the same representative component at the
// old and the new motion, Replay to restart both in sync, and the other components the change touches.
// Self-contained: give it the changes (lib/motion-changes.ts motionChanges) and the head specs; it renders nothing when
// the branch changes no motion. Under prefers-reduced-motion the previews are still frames with the durations written.
// Mount from a page script with mountMotionChanges (scripts/reviews/motion-changes.ts).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { Button, Link } from '@bridge-ds/react';
import type { ComponentSpecsFile } from '@bridge-ds/core';
import { alsoChanges, motionHeadline, motionPreview, type MotionChange, type MotionPreview, type PreviewSide } from '../../../lib/motion-changes';
import '../../../styles/motion-changes.css';

type Specs = Pick<ComponentSpecsFile, 'components'>;

export interface MotionChangesProps {
  changes: MotionChange[];
  /** The component specs on the branch (packages/react/component-specs.json at its head). */
  specs: Specs | null;
  /** Token alias chain on the branch, so a changed primitive finds the motion tokens using it. */
  chainOf?: ((path: string) => string[]) | undefined;
  /** Where a component name links; defaults to its Library page, Motion section. */
  componentHref?: ((component: string) => string) | undefined;
}

const kebab = (s: string) =>
  s
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
const libraryHref = (component: string) => `/components/${kebab(component)}/#motion`;

const reducedQuery = '(prefers-reduced-motion: reduce)';
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia(reducedQuery);
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return reduced;
}

/** Start and end frames of a shape, for the Web Animations API. Only opacity and transform move. */
function frames(shape: MotionPreview['shape'], verb: string): { target: string; from: Keyframe; to: Keyframe } {
  const closing = verb === 'closes' || verb === 'unchecks';
  const pair = (a: Keyframe, b: Keyframe) => (closing ? { from: b, to: a } : { from: a, to: b });
  if (shape === 'popup') return { target: '[data-mc-move]', ...pair({ opacity: 0, transform: 'scale(0.96)' }, { opacity: 1, transform: 'scale(1)' }) };
  if (shape === 'panel') return { target: '[data-mc-move]', ...pair({ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }) };
  if (shape === 'toggle') return { target: '[data-mc-move]', ...pair({ transform: 'translateX(0)' }, { transform: 'translateX(100%)' }) };
  return { target: '[data-mc-move]', ...pair({ opacity: 0 }, { opacity: 1 }) };
}

/** One loop: rest, then the moment at its duration and easing, then hold. Both sides share the loop length. */
function keyframes(side: PreviewSide, loop: number, f: { from: Keyframe; to: Keyframe }): Keyframe[] {
  const start = 0.2;
  const end = Math.min(0.95, start + side.ms / loop);
  return [
    { ...f.from, offset: 0 },
    { ...f.from, offset: start, easing: `cubic-bezier(${side.bezier.join(', ')})` },
    { ...f.to, offset: end },
    { ...f.to, offset: 1 },
  ];
}

function Sketch({ shape }: { shape: MotionPreview['shape'] }) {
  if (shape === 'popup')
    return (
      <div className="mc-popup" data-mc-move>
        <span className="mc-line mc-line-title" />
        <span className="mc-line" />
        <span className="mc-pill" />
      </div>
    );
  if (shape === 'panel')
    return (
      <div className="mc-panel">
        <span className="mc-panel-head">
          <span className="mc-line mc-line-title" />
        </span>
        <span className="mc-panel-body" data-mc-move>
          <span className="mc-line" />
          <span className="mc-line mc-line-short" />
        </span>
      </div>
    );
  if (shape === 'toggle')
    return (
      <span className="mc-track">
        <span className="mc-thumb-lane">
          <span className="mc-thumb" data-mc-move />
        </span>
      </span>
    );
  return (
    <span className="mc-control">
      <span className="mc-control-hover" data-mc-move />
      <span className="mc-line mc-line-on-action" />
    </span>
  );
}

function Previews({ preview, reduced, onPlaying }: { preview: MotionPreview; reduced: boolean; onPlaying: (anims: Animation[]) => void }) {
  const before = useRef<HTMLDivElement>(null);
  const after = useRef<HTMLDivElement>(null);
  const anims = useRef<Animation[]>([]);
  const loop = Math.max(2400, Math.ceil((Math.max(preview.before.ms, preview.after.ms) * 2.5) / 100) * 100);

  useEffect(() => {
    anims.current.forEach((a) => a.cancel());
    anims.current = [];
    if (reduced) return onPlaying([]);
    const f = frames(preview.shape, preview.verb);
    for (const [host, side] of [
      [before.current, preview.before],
      [after.current, preview.after],
    ] as const) {
      const el = host?.querySelector<HTMLElement>(f.target);
      if (!el || typeof el.animate !== 'function') continue;
      anims.current.push(el.animate(keyframes(side, loop, f), { duration: loop, iterations: Infinity }));
    }
    onPlaying(anims.current);
    return () => anims.current.forEach((a) => a.cancel());
  }, [preview, reduced, loop, onPlaying]);

  const caption = (side: PreviewSide) => `${preview.component} ${preview.verb} in ${Math.round(side.ms)} ms`;
  return (
    <>
      <div className={`mc-previews${reduced ? ' is-still' : ''}`}>
        {(
          [
            ['Before', preview.before, before],
            ['After', preview.after, after],
          ] as const
        ).map(([label, side, ref]) => (
          <figure className="mc-figure" key={label}>
            <div className="mc-stage" ref={ref} aria-hidden="true">
              <Sketch shape={preview.shape} />
            </div>
            <figcaption className="mc-caption">
              <span>{label}</span>
              <span>{caption(side)}</span>
            </figcaption>
          </figure>
        ))}
      </div>
    </>
  );
}

function Headline({ change, specs, chainOf }: { change: MotionChange; specs: Specs | null; chainOf?: MotionChangesProps['chainOf'] }) {
  const h = motionHeadline(change, specs, chainOf);
  return (
    <p className="mc-sentence">
      {h.lead}
      {h.token ? (
        <>
          : <code className="mc-token">{h.token}</code> goes from <strong>{h.before}</strong> to <strong>{h.after}</strong>.
        </>
      ) : (
        <>
          : from <strong>{h.before}</strong> to <strong>{h.after}</strong>.
        </>
      )}
    </p>
  );
}

function Also({ change, specs, href }: { change: MotionChange; specs: Specs | null; href: (c: string) => string }) {
  const [open, setOpen] = useState(false);
  const { first, all } = alsoChanges(change, specs);
  if (all.length <= 1) return null;
  const names = open ? all : first;
  return (
    <p className="mc-also">
      {open ? 'Changes: ' : 'Also changes: '}
      {names.map((n, i) => (
        <span key={n}>
          {i > 0 && ', '}
          <Link variant="subtle" href={href(n)}>
            {n}
          </Link>
        </span>
      ))}
      {!open && all.length - 1 > first.length && (
        <>
          {' · '}
          <Button variant="link" size="sm" onClick={() => setOpen(true)}>
            See all {all.length}
          </Button>
        </>
      )}
    </p>
  );
}

export default function MotionChanges({ changes, specs, chainOf, componentHref = libraryHref }: MotionChangesProps) {
  const reduced = useReducedMotion();
  const [main, ...more] = changes;
  const preview = useMemo(() => (main ? motionPreview(main, specs, chainOf) : null), [main, specs, chainOf]);
  const anims = useRef<Animation[]>([]);
  const [canReplay, setCanReplay] = useState(false);
  const onPlaying = useCallback((a: Animation[]) => {
    anims.current = a;
    setCanReplay(a.length > 0);
  }, []);
  // Both previews restart together, so the old and the new motion start on the same frame.
  const replay = () => {
    for (const a of anims.current) {
      a.currentTime = 0;
      a.play();
    }
  };
  if (!main) return null;
  return (
    <section className="mc" aria-labelledby="mc-title">
      <div className="mc-head">
        <h2 id="mc-title" className="mc-title">
          Motion changes
        </h2>
        {canReplay && (
          <Button variant="secondary" iconStart={RotateCcw} onClick={replay}>
            Replay
          </Button>
        )}
      </div>
      <Headline change={main} specs={specs} chainOf={chainOf} />
      {preview && <Previews preview={preview} reduced={reduced} onPlaying={onPlaying} />}
      <Also change={main} specs={specs} href={componentHref} />
      {more.length > 0 && (
        <ul className="mc-more">
          {more.map((c, i) => (
            <li key={`${c.token}|${c.when}|${i}`}>
              <Headline change={c} specs={specs} chainOf={chainOf} />
              <Also change={c} specs={specs} href={componentHref} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
