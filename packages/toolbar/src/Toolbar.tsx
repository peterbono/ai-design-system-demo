// The Bridge toolbar: opened from Bridge Studio ("Try it in the product") with `?bridge=<change>`, it lets a designer
// browse the real product and flip between the live product and this change. Token changes swap the live tokens in
// without a reload; code changes move between the product in production and the change's preview on the same screen.
// Production renders nothing on its own. It opens collapsed, bottom right of the content column, and moves away from
// the page's primary and submit buttons. Several token changes tried together (`?bridge=101,118,120`, from Studio's
// Changes list) run on the product in production: their combined tokens are applied live (useTogether), each change can
// be switched off, and Before/After and "Show what changed" work on what is switched on.
// The changes of a screen are outlined as soon as the toolbar is open, counted in the bar ("3 changes") and stepped
// through with Previous and Next; Isolate dims everything else, and B flips sides in place.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Badge, Button, ButtonGroup, Checkbox, Icon, IconButton, Kbd, Link, Popover, PopoverContent, PopoverTrigger, ThemeProvider, Tooltip } from '@bridge-ds/react';
import { Check, ChevronUp, GripVertical, Info, ListChecks, Minimize2 } from 'lucide-react';
import { loadChange, type ChangeFacts } from './github';
import { loadBuild } from './config';
import type { BridgeToolbarProps } from './BridgeToolbar';
import { useDocumentScope, type ToolbarScope, type ToolbarShop } from './scope';
import type { TogetherBase } from './together';
import {
  changeSummary,
  DOCK_KEY,
  dockAt,
  isFlipKey,
  liveTokensUrl,
  noVisibleDifference,
  OPEN_KEY,
  PARAM,
  placeToolbar,
  readChanges,
  readDock,
  readReturn,
  readScroll,
  readUse,
  sameScreenOn,
  SCROLL_PARAM,
  shouldRender,
  stepDock,
  studioChangeUrl,
  studioChangesUrl,
  fromText,
  TOGETHER_EMPTY_LINE,
  TOGETHER_HINT,
  togetherLabel,
  contrastRatio,
  isSubtle,
  toHex,
  whereAmI,
  type BridgeBuild,
  type Dock,
  type NoDifference,
  type Rect,
  type Screen,
  type TokenChange,
} from './session';
import { EMPTY_LINE, isKey, surfaceLine } from './diff';
import { isPage, rendered, shownRect } from './outline';
import { changeCount, elsewhereLine, isEscape, positionLabel, readingOrder, stepAnnouncement, stepTo } from './navigate';
import { useChangedElements } from './useChangedElements';
import { ChangeOutlines, type Shown } from './ChangeOutlines';
import { ChangeNav } from './ChangeNav';
import { PIN_ATTR, PIN_CLASS, usePinnedBridgeTokens } from './pin';
import { useTogether } from './useTogether';
import styles from './BridgeToolbar.module.css';

type Side = 'before' | 'after';
type TokenState = 'idle' | 'loading' | 'ready' | 'error';

/** The two sides, in the words designers use. */
const SIDE_LABEL: Record<Side, string> = { before: 'Live product', after: 'This change' };

function session(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function remember(key: string, value: string) {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
}

/** The toolbar once a change is asked for: its facts from the build, else from the design system's config. */
export default function ToolbarRoot(props: BridgeToolbarProps) {
  const { ds, product, studio, production, preview, deployEnv, proxy } = props;
  // The proxy prop wins over the one a build carries (default: production Bridge, reads.ts).
  const given = useMemo(() => (props.build && proxy !== undefined ? { ...props.build, proxy } : props.build), [props.build, proxy]);
  const [build, setBuild] = useState<BridgeBuild | null>(given ?? null);
  useEffect(() => {
    if (given || !ds || !product) return;
    let live = true;
    loadBuild(ds, product, { studio, production, preview, deployEnv, ...(proxy !== undefined ? { proxy } : {}) }).then(
      (b) => live && setBuild(b),
      (err: Error) => console.warn(`Bridge toolbar: ${err.message}`),
    );
    return () => {
      live = false;
    };
  }, [given, ds, product, studio, production, preview, deployEnv, proxy]);
  if (!build) return null;
  return <Decide build={build} useScope={props.scope ?? useDocumentScope} shops={props.shops ?? []} together={props.together ?? null} />;
}

/** Decides on first render whether there is anything to show. */
function Decide({ build: given, useScope, shops, together: latest }: { build: BridgeBuild; useScope: () => ToolbarScope; shops: ToolbarShop[]; together: (() => Promise<TogetherBase>) | null }) {
  const [setup] = useState(() => {
    const build = given;
    const store = session();
    const changes = readChanges(window.location.search, store);
    const where = whereAmI(window.location.host, build);
    const returnTo = where === 'production' ? readReturn(window.location.search, store, build.preview) : null;
    // 2 to 4 changes tried together: their tokens are applied live on whatever this admin is (production from Studio).
    const together = changes.length > 1 ? { changes, use: readUse(window.location.search, store) } : null;
    return { build, change: changes[0] ?? null, where, returnTo, together };
  });
  if (!shouldRender({ ...setup, together: Boolean(setup.together) })) return null;
  return <Toolbar build={setup.build} change={setup.change!} onProduction={setup.where === 'production'} returnTo={setup.returnTo} together={setup.together} useScope={useScope} shops={shops} latest={latest} />;
}

/**
 * The live tokens: one stylesheet after the bundled one, loaded on demand (the live side, or "Show what changed") and
 * switched by its media ("all" applies it, "not all" keeps it loaded but off), so flipping is instant and the
 * comparison can switch it inside one task without a visible flash.
 */
function useLiveSheet(url: string | null, need: boolean, applied: boolean): { state: TokenState; link: HTMLLinkElement | null } {
  const [state, setState] = useState<TokenState>('idle');
  const link = useRef<HTMLLinkElement | null>(null);
  useEffect(() => {
    if (!url) return;
    if (link.current) {
      link.current.media = applied ? 'all' : 'not all';
      return;
    }
    if (!need && !applied) return;
    const el = document.createElement('link');
    el.rel = 'stylesheet';
    el.href = url;
    el.media = applied ? 'all' : 'not all';
    el.referrerPolicy = 'no-referrer';
    el.setAttribute('data-bridge-live', '');
    el.onload = () => setState('ready');
    el.onerror = () => {
      el.remove();
      link.current = null;
      setState('error');
    };
    link.current = el;
    setState('loading');
    document.head.appendChild(el);
  }, [url, need, applied]);
  useEffect(() => () => link.current?.remove(), []);
  return { state, link: state === 'ready' ? link.current : null };
}

interface Pair {
  token: TokenChange;
  before: string;
  after: string;
  color: boolean;
}

/** Resolves each token in a scope (theme, brand) on a probe: its colour as rgb, or its raw value. */
function probe(root: Node, tokens: TokenChange[], scope: { theme: string; brand: string }): string[] {
  const host = document.createElement('div');
  host.setAttribute('data-theme', scope.theme);
  host.setAttribute('data-brand', scope.brand);
  host.setAttribute('data-density', 'comfortable');
  host.style.display = 'none';
  const spans = tokens.map((t) => {
    const s = document.createElement('span');
    s.style.backgroundColor = `var(${t.cssVar})`;
    host.appendChild(s);
    return s;
  });
  root.appendChild(host);
  const out = tokens.map((t, i) => (t.type === 'color' ? getComputedStyle(spans[i]!).backgroundColor : getComputedStyle(host).getPropertyValue(t.cssVar).trim()));
  host.remove();
  return out;
}

/**
 * Before and after of every changed token, in the theme and brand where it shows: after from this page's own
 * tokens (read while the live tokens are off), before from the live tokens.css applied in an isolated shadow root.
 */
function usePairs(facts: ChangeFacts | null, liveUrl: string | null, brand: string, liveOn: boolean): Pair[] {
  const [pairs, setPairs] = useState<Pair[]>([]);
  const afterCache = useRef(new Map<string, string[]>());
  useEffect(() => {
    const tokens = facts?.tokens ?? [];
    if (!tokens.length || !liveUrl) return;
    let live = true;
    const scopeOf = (t: TokenChange) => ({ theme: t.theme ?? 'light', brand: t.brand ?? brand });
    const key = `${brand}`;
    // After: only readable while the live stylesheet is off; kept per brand.
    if (!afterCache.current.has(key) && !liveOn) afterCache.current.set(key, tokens.map((t) => probe(document.body, [t], scopeOf(t))[0]!));
    const after = afterCache.current.get(key);
    if (!after) return;
    fetch(liveUrl)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((css) => {
        if (!live) return;
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(css.replace(/:root/g, ':host'));
        const host = document.createElement('div');
        host.style.display = 'none';
        document.body.appendChild(host);
        const shadow = host.attachShadow({ mode: 'open' });
        shadow.adoptedStyleSheets = [sheet];
        const before = tokens.map((t) => probe(shadow, [t], scopeOf(t))[0]!);
        host.remove();
        setPairs(tokens.map((t, i) => ({ token: t, before: before[i]!, after: after[i]!, color: t.type === 'color' })).filter((p) => p.before !== p.after));
      })
      .catch(() => live && setPairs([]));
    return () => {
      live = false;
    };
  }, [facts, liveUrl, brand, liveOn]);
  return pairs;
}

/** What the active side shows, after its bold name. */
function modeDetail(facts: ChangeFacts | null, side: Side, tokens: TokenState): string {
  if (!facts) return 'Reading the change.';
  if (side === 'before') {
    if (tokens === 'loading') return 'loading what customers see today.';
    if (tokens === 'error') return 'could not load it. Check your connection, then press B again.';
    return 'what customers see today.';
  }
  return changeSummary(facts.title);
}

const brandName = (shops: ToolbarShop[], brand: string) => shops.find((t) => t.brand === brand)?.name ?? brand;

/** "Light mode only. Nothing changes in dark." */
function noDifferenceText(d: NoDifference, shops: ToolbarShop[]): string {
  const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
  return d.kind === 'theme' ? `${cap(d.touched)} mode only. Nothing changes in ${d.here}.` : `${brandName(shops, d.touched)} only. Nothing changes in ${brandName(shops, d.here)}.`;
}

/** Primary and submit buttons of the page, in the viewport: the toolbar never covers them. */
function pageObstacles(own: HTMLElement | null): Rect[] {
  const probeEl = document.createElement('span');
  probeEl.style.backgroundColor = 'var(--color-action-primary-bg)';
  probeEl.hidden = true;
  document.body.appendChild(probeEl);
  const primary = getComputedStyle(probeEl).backgroundColor;
  probeEl.remove();
  const out: Rect[] = [];
  for (const el of document.querySelectorAll<HTMLElement>('button, a[href], [role="button"]')) {
    if (own?.contains(el) || el.closest('[data-bridge-toolbar], [role="dialog"], [role="menu"], [role="listbox"]')) continue;
    const isSubmit = el instanceof HTMLButtonElement && el.type === 'submit';
    if (!isSubmit && getComputedStyle(el).backgroundColor !== primary) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || r.bottom <= 0 || r.top >= window.innerHeight) continue;
    out.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
  }
  return out;
}

function Toolbar({
  build,
  change,
  onProduction,
  returnTo,
  together: tg,
  useScope,
  shops,
  latest,
}: {
  build: BridgeBuild;
  change: number;
  onProduction: boolean;
  returnTo: string | null;
  together: { changes: number[]; use: string | null } | null;
  useScope: () => ToolbarScope;
  shops: ToolbarShop[];
  latest: (() => Promise<TogetherBase>) | null;
}) {
  const scope = useScope();
  const { theme, density, brand } = scope;
  const tenantId = scope.shop ?? '';
  const setPrefs = scope.set;
  const isTenantId = (id: string) => shops.some((t) => t.id === id);
  const [oneFacts, setFacts] = useState<ChangeFacts | null>(null);
  const [oneError, setError] = useState(false);
  // On production the toolbar only exists for the live side of a code change, or for changes tried together (which
  // open on the combination).
  const [side, setSide] = useState<Side>(onProduction && !tg ? 'before' : 'after');
  const T = useTogether(build, latest, tg?.changes ?? null, tg?.use ?? null, { theme, brand, density }, side === 'after');
  const titleOf = (n: number) => T?.list?.find((f) => f.number === n)?.title ?? null;
  // Changes tried together read as one token change: the tokens of what is switched on, the files they edit.
  const togetherFacts = useMemo<ChangeFacts | null>(() => {
    if (!T?.list || !T.result) return null;
    const on = T.list.filter((f) => T.included.includes(f.number));
    const names = on.map((f) => f.title);
    return {
      number: change,
      title: names.length ? (names.length <= 2 ? names.join(' and ') : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`) : 'No change switched on',
      url: '',
      sha: '',
      mode: 'tokens',
      files: [...new Set(on.flatMap((f) => f.source?.files ?? []))],
      behind: null,
      tokens: T.result.tokens,
      screens: null,
    };
  }, [T?.list, T?.result, T?.included, change]);
  const facts = tg ? togetherFacts : oneFacts;
  const error = tg ? Boolean(T?.error) : oneError;
  const [open, setOpen] = useState(() => {
    try {
      return window.sessionStorage.getItem(OPEN_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [dock, setDock] = useState<Dock>(() => readDock(session()));
  const [place, setPlace] = useState<{ dock: Dock; lift: number }>({ dock, lift: 0 });
  const [drag, setDrag] = useState<number | null>(null);
  // Set when the toolbar moved the page to the only theme the change touches: "Shown in light...".
  const [shownIn, setShownIn] = useState<string | null>(null);
  const dragStart = useRef(0);
  const root = useRef<HTMLDivElement>(null);
  const hash = useHash();

  useEffect(() => {
    if (tg) return;
    let live = true;
    loadChange(build, change).then(
      (f) => live && setFacts(f),
      () => live && setError(true),
    );
    return () => {
      live = false;
    };
  }, [build, change, tg]);

  // One change: the live tokens.css switches the preview to Before. Changes tried together: this page is the live
  // product already, and the combination's sheet (useTogether) switches it to After.
  const liveUrl = !tg && facts?.mode === 'tokens' ? liveTokensUrl(build) : null;
  // Outlines follow the bar: on while it is open (the changes are the point of opening it), until the person turns
  // them off (or on) themselves.
  const [outlinePick, setOutlinePick] = useState<boolean | null>(null);
  const outlines = outlinePick ?? open;
  const toggleOutlines = useCallback(() => setOutlinePick((p) => !(p ?? open)), [open]);
  const canOutline = facts?.mode === 'tokens' && (facts.tokens.length ?? 0) > 0;
  const live = useLiveSheet(liveUrl, outlines && canOutline, side === 'before' && facts?.mode === 'tokens');
  const onePairs = usePairs(tg ? null : facts, liveUrl, brand, side === 'before');
  const pairs: Pair[] = tg ? (T?.pairs ?? []) : onePairs;
  // Changes tried together: measured on the combination's own values where the page is.
  const noDiff = tg ? (T?.noDiff ?? null) : facts?.mode === 'tokens' ? noVisibleDifference(facts.files, { theme, brand: brand }) : null;
  // Outlines run only where the change can show: muted in dark for a light-only change.
  const outlinesOn = outlines && canOutline && !noDiff;
  // Switching a change on or off repaints the combination: the outlines are measured again.
  const screenKey = `${hash}|${theme}|${tenantId}|${tg ? (T?.included.join(',') ?? '') : ''}`;
  const diff = useChangedElements(
    outlinesOn,
    tg ? (T?.sheet ?? null) : live.link,
    (facts?.tokens ?? []).map((t) => t.cssVar),
    screenKey,
    tg ? 'after' : 'before',
  );
  const nameOf = (v: string) => facts?.tokens.find((t) => t.cssVar === v)?.name ?? v;
  // What the outlines draw (visible surfaces) and where: the count and the boxes the toolbar keeps clear of.
  const [shown, setShown] = useState<Shown>({ count: 0, obstacles: [] });
  const setShownStable = useCallback((next: Shown) => setShown((p) => (JSON.stringify(p) === JSON.stringify(next) ? p : next)), []);
  const outlineBoxes = useRef<Rect[]>([]);
  outlineBoxes.current = outlinesOn ? shown.obstacles : [];
  // The list row a person points at (its surface shows its chip and a stronger outline), the brief chip flash when
  // outlines turn on (none with reduced motion), and the Changes sheet.
  const [emphasis, setEmphasis] = useState<number | null>(null);
  const [flash, setFlash] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  // Stepping through the changes: the position in reading order (null until Previous or Next), what a screen reader
  // hears on each step, and Isolate (off by default, Esc turns it off).
  const [position, setPosition] = useState<number | null>(null);
  const [announce, setAnnounce] = useState('');
  const [isolate, setIsolate] = useState(false);
  const phone = useMedia('(max-width: 760px)');
  const reduced = useMedia('(prefers-reduced-motion: reduce)');
  usePinnedBridgeTokens(liveTokensUrl(build), theme);
  useEffect(() => {
    if (!outlinesOn || reduced) {
      setFlash(false);
      return;
    }
    setFlash(true);
    const id = window.setTimeout(() => setFlash(false), 1500);
    return () => window.clearTimeout(id);
  }, [outlinesOn, reduced]);
  useEffect(() => {
    if (!sheetOpen) setEmphasis(null);
  }, [sheetOpen]);

  // A change that only touches one theme opens in that theme, once, and says so.
  const autoTheme = useRef(false);
  useEffect(() => {
    if (autoTheme.current || !facts) return;
    autoTheme.current = true;
    if (noDiff?.kind === 'theme' && (noDiff.touched === 'light' || noDiff.touched === 'dark')) {
      setPrefs({ theme: noDiff.touched });
      setShownIn(noDiff.touched);
    }
  }, [facts, noDiff, setPrefs]);
  // The note holds while the page stays in that theme.
  useEffect(() => {
    if (shownIn && theme !== shownIn) setShownIn(null);
  }, [theme, shownIn]);

  // A side switch carried the scroll position: restore it once the screen has its height, then tidy the address.
  useEffect(() => {
    const y = readScroll(window.location.search);
    if (y === null) return;
    const url = new URL(window.location.href);
    url.searchParams.delete(SCROLL_PARAM);
    window.history.replaceState(window.history.state, '', url);
    let tries = 0;
    const id = window.setInterval(() => {
      tries += 1;
      if (document.documentElement.scrollHeight - window.innerHeight >= y || tries > 20) {
        window.scrollTo({ top: y });
        window.clearInterval(id);
      }
    }, 150);
    return () => window.clearInterval(id);
  }, []);

  const choose = useCallback(
    (next: Side) => {
      if (next === side || !facts) return;
      if (facts.mode === 'tokens') {
        setSide(next);
        return;
      }
      const here = { search: window.location.search, hash: window.location.hash };
      if (next === 'before' && build.production) {
        window.location.assign(sameScreenOn(build.production, here, { change, returnTo: window.location.origin, scroll: window.scrollY }));
      } else if (next === 'after' && returnTo) {
        window.location.assign(sameScreenOn(returnTo, here, { change, scroll: window.scrollY }));
      }
    },
    [side, facts, build, change, returnTo],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (canOutline && !noDiff && isKey(e, 'c')) {
        e.preventDefault();
        toggleOutlines();
        return;
      }
      if (!isFlipKey(e)) return;
      e.preventDefault();
      choose(side === 'after' ? 'before' : 'after');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [choose, side, canOutline, noDiff, toggleOutlines]);
  // Escape turns Isolate off, also from the bar's own controls (their tooltip stops Escape before it bubbles).
  useEffect(() => {
    if (!isolate) return;
    const onEscape = (e: KeyboardEvent) => {
      if (isEscape(e)) setIsolate(false);
    };
    window.addEventListener('keydown', onEscape, true);
    return () => window.removeEventListener('keydown', onEscape, true);
  }, [isolate]);

  // Stay clear of the page's primary and submit buttons: on open, resize, scroll, route change and size change.
  useLayoutEffect(() => {
    const el = root.current;
    const anchor = el?.parentElement;
    if (!el || !anchor) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const box = el.getBoundingClientRect();
        const area = anchor.getBoundingClientRect();
        const gutter = window.innerWidth <= 760 ? (open ? 0 : 8) : 16;
        const next = placeToolbar({ left: area.left, right: area.right, vh: window.innerHeight, w: box.width, h: box.height, gutter, preferred: dock, obstacles: [...pageObstacles(el), ...outlineBoxes.current] });
        setPlace((p) => (p.dock === next.dock && p.lift === next.lift ? p : next));
        // While open the page gets room for the toolbar, so its end is never hidden under it.
        document.body.style.paddingBottom = open ? `${box.height + 2 * gutter}px` : '';
      });
    };
    measure();
    const later = window.setTimeout(measure, 600);
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    ro?.observe(el);
    ro?.observe(document.body);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('hashchange', measure);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(later);
      ro?.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure);
      window.removeEventListener('hashchange', measure);
      document.body.style.paddingBottom = '';
    };
  }, [dock, open, facts, shown, outlinesOn]);

  const toggleOpen = (next: boolean) => {
    setOpen(next);
    remember(OPEN_KEY, next ? '1' : '0');
  };
  const moveTo = (next: Dock) => {
    setDock(next);
    remember(DOCK_KEY, next);
  };
  const onGripKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      moveTo(stepDock(dock, e.key === 'ArrowLeft' ? -1 : 1));
    }
  };
  const onGripDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStart.current = e.clientX;
    setDrag(0);
  };
  const onGripMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (drag !== null) setDrag(e.clientX - dragStart.current);
  };
  const onGripUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (drag === null) return;
    const box = root.current?.getBoundingClientRect();
    setDrag(null);
    if (box && Math.abs(e.clientX - dragStart.current) > 4) moveTo(dockAt(box.left + box.width / 2, window.innerWidth));
  };

  // Moving to another screen or theme from the toolbar keeps it open.
  const goTo = (s: Screen) => (e: ReactMouseEvent) => {
    e.preventDefault();
    toggleOpen(true);
    if (isTenantId(s.tenant) && (s.tenant !== tenantId || s.theme !== theme)) setPrefs({ shop: s.tenant, theme: s.theme === 'dark' ? 'dark' : 'light' });
    window.location.hash = s.route;
  };
  const fixNoDiff = () => {
    if (!noDiff) return;
    toggleOpen(true);
    if (noDiff.kind === 'theme') setPrefs({ theme: noDiff.touched === 'dark' ? 'dark' : 'light' });
    else {
      const t = shops.find((x) => x.brand === noDiff.touched);
      if (t) setPrefs({ shop: t.id });
    }
  };

  const sideLabel = (x: Side) => (x === 'after' && tg ? togetherLabel(T?.included.length ?? tg.changes.length) : SIDE_LABEL[x]);
  const label = sideLabel(side);
  const title = facts?.title ?? (tg ? `${tg.changes.length} changes together` : `Change ${change}`);
  const screens = facts?.screens ?? null;
  const canFlip = Boolean(facts) && (facts!.mode === 'tokens' || (side === 'after' ? Boolean(build.production) : Boolean(returnTo)));
  const studio = tg ? studioChangesUrl(build) : studioChangeUrl(build, change);
  const behind = facts?.behind ? 'Live has new changes since this change started.' : null;
  // Screens share one shop and theme most of the time: say it once in the sheet's header.
  const shared = screens?.length && screens.every((s) => s.tenant === screens[0]!.tenant && s.theme === screens[0]!.theme) ? screens[0]! : null;
  const shopOf = (t: string) => shops.find((x) => x.id === t)?.name ?? t;
  const surfaces = useMemo(() => (outlinesOn ? (diff?.surfaces ?? []) : []), [outlinesOn, diff]);
  const shownCount = outlinesOn && diff ? shown.count : null;
  // Every changed surface that shows on this screen, in view or further down, in reading order: what the bar counts
  // and what Previous and Next step through (indexes into surfaces).
  const order = useMemo(() => {
    const on = surfaces.map((s, i) => ({ s, i })).filter(({ s }) => rendered(s.el));
    const places = on.map(({ s }) => {
      if (isPage(s.el)) return { top: -1, left: 0 };
      const r = s.el.getBoundingClientRect();
      return { top: r.top + window.scrollY, left: r.left + window.scrollX };
    });
    return readingOrder(places).map((k) => on[k]!.i);
  }, [surfaces]);
  const total = outlinesOn && diff ? order.length : null;
  const current = position !== null ? (order[position] ?? null) : null;
  // A new screen, theme or shop starts over; so do outlines turned off. Isolate needs something to isolate.
  useEffect(() => {
    setPosition(null);
    setAnnounce('');
  }, [screenKey, outlinesOn]);
  useEffect(() => {
    if (position !== null && position >= order.length) setPosition(null);
  }, [order.length, position]);
  const isolateOn = isolate && Boolean(total);
  const step = (delta: 1 | -1) => {
    const next = stepTo(position, delta, order.length);
    if (next === null) return;
    const s = surfaces[order[next]!]!;
    setPosition(next);
    setEmphasis(null);
    // The page canvas is everywhere: stepping to it leaves the scroll where it is.
    if (!isPage(s.el)) s.el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
    setAnnounce(stepAnnouncement(next, order.length, s.label));
  };

  // The screens this change shows on, other than this one: where to go when nothing changes here.
  const isHere = (sc: Screen) => sc.route === hash && sc.tenant === tenantId && sc.theme === theme;
  const elsewhere = (screens ?? []).filter((sc) => !isHere(sc));
  const screenHref = (sc: Screen) => `?${PARAM}=${change}&tenant=${encodeURIComponent(sc.tenant)}&theme=${encodeURIComponent(sc.theme)}#${sc.route}`;

  // Changes tried together: how many of the switched-on ones show anything in this theme and brand.
  const activeHere = new Set((T?.pairs ?? []).flatMap((p) => p.token.from)).size;
  const note = shownIn ? (
    <p className={styles.note} role="status">
      Shown in {shownIn}. {tg ? 'These changes only affect' : 'This change only affects'} {shownIn}.
    </p>
  ) : noDiff ? (
    <p className={styles.note} role="status">
      <span>{noDifferenceText(noDiff, shops)}</span>
      <Button variant="ghost" size="md" onClick={fixNoDiff} className={styles.noteAction}>
        {noDiff.kind === 'theme' ? `Switch to ${noDiff.touched}` : `Switch to ${brandName(shops, noDiff.touched)}`}
      </Button>
    </p>
  ) : (outlinesOn || side === 'before') && live.state === 'error' ? (
    <p className={styles.note} role="status">
      Could not load the live product. Check your connection, then try again.
    </p>
  ) : total === 0 ? (
    tg ? (
      <p className={styles.note} role="status">
        {TOGETHER_EMPTY_LINE}
      </p>
    ) : elsewhere.length ? (
      <p className={styles.note} role="status">
        <span>{elsewhereLine(elsewhere.map((sc) => sc.label))}</span>
        <Button variant="ghost" size="md" render={<a href={screenHref(elsewhere[0]!)} />} onClick={goTo(elsewhere[0]!)} className={styles.noteAction}>
          Go to {elsewhere[0]!.label}
        </Button>
      </p>
    ) : (
      <p className={styles.note} role="status">
        {screens ? elsewhereLine([]) : EMPTY_LINE}
      </p>
    )
  ) : total && shownCount === 0 && position === null ? (
    <p className={styles.note} role="status">
      Nothing changed in view. Next takes you to {total === 1 ? 'the change' : `the ${total} changes`}.
    </p>
  ) : tg && T && side === 'after' && activeHere < T.included.length ? (
    <p className={styles.note} role="status">
      {activeHere} of these {T.included.length} changes {activeHere === 1 ? 'shows' : 'show'} in {theme}. Changes lists what each one does here.
    </p>
  ) : null;

  // The colour pair of each changed token: one split swatch (before half, after half); values in its tooltip only.
  // Most visible first: a ramp change lists its strong steps before its near-white ones.
  const visiblePairs = (noDiff ? [] : pairs).slice().sort((a, b) => (contrastRatio(b.before, b.after) ?? 0) - (contrastRatio(a.before, a.after) ?? 0));
  const hexPair = (before: string, after: string) => `${toHex(before).toUpperCase()} → ${toHex(after).toUpperCase()}`;
  // Changes tried together: each token says which change its value comes from.
  const fromOf = (p: Pair | null | undefined) => {
    const from = (p?.token as { from?: number[] } | undefined)?.from;
    return tg && from?.length ? fromText(from, titleOf) : null;
  };
  const splitOf = (before: string, after: string) => (
    <span className={styles.split} aria-hidden="true">
      <span style={{ backgroundColor: before }} />
      <span style={{ backgroundColor: after }} />
    </span>
  );
  const subtleOf = (before: string, after: string) => (isSubtle(before, after) ? <span className={styles.subtle}>Subtle change</span> : null);
  // One row per role in the Changes sheet ("Brand primary", "Link"), its most visible step's swatch first.
  const roleGroups = [...visiblePairs.reduce((m, p) => m.set(p.token.name, [...(m.get(p.token.name) ?? []), p]), new Map<string, Pair[]>())].map(([name, list]) => ({ name, pairs: list }));

  // Show what changed: token changes only. A code change's live side is another origin (the production admin), whose
  // styles this page cannot read, so there is nothing reliable to compare: no outlines, no count. Muted where the
  // change shows nothing (dark for a light-only change). Token changes keep the same elements on both sides, so the
  // outlines, the position and Isolate hold when the person flips to Live product.
  const tokenNames = (facts?.tokens ?? []).map((t) => t.name);
  const summary = shownCount === null ? null : surfaceLine(diff!.surfaces.flatMap((s) => s.roots.map(nameOf)), total ?? shownCount);
  const countText = !outlinesOn ? 'Show what changed' : total === null ? 'Finding changes' : total === 0 ? 'No changes here' : position !== null ? `Change ${positionLabel(position, total)}` : changeCount(total);
  const toggleTip = outlinesOn ? `${summary ? `${summary}. ` : ''}Press C to hide the outlines.` : `Outline what ${tokenNames.length === 1 ? tokenNames[0] : 'this change'} changes on this screen. Press C.`;
  const nav = canOutline ? (
    <ChangeNav
      countText={countText}
      tip={toggleTip}
      outlinesOn={outlinesOn}
      disabled={Boolean(noDiff)}
      total={total}
      isolate={isolateOn}
      announce={announce}
      onToggle={toggleOutlines}
      onStep={step}
      onIsolate={setIsolate}
    />
  ) : null;
  const shownSurfaces = surfaces.map((s, i) => ({ s, i })).filter(({ s }) => shownRect(s.el));
  const focusSurface = (i: number) => {
    const el = surfaces[i]?.el;
    if (!el) return;
    if (!isPage(el)) el.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
    setEmphasis(i);
    if (order.includes(i)) setPosition(order.indexOf(i));
  };
  const tokensOf = (x: { roots: string[] }) => [...new Set(x.roots.map(nameOf))].join(', ');

  const sides = (
    <ButtonGroup appearance="attached" aria-label="Compare" className={styles.sides}>
      {(['before', 'after'] as const).map((s) => (
        <Tooltip
          className={PIN_CLASS}
          key={s}
          content={
            <>
              {sideLabel(s)}: {s === 'before' ? 'what customers see today.' : modeDetail(facts, 'after', 'idle')} <Kbd keys="B" size="sm" /> flips sides on the same screen.
            </>
          }
        >
          <Button
            variant="secondary"
            size="md"
            pressed={side === s}
            aria-keyshortcuts="B"
            disabled={!canFlip && side !== s}
            onClick={() => choose(s)}
          >
            {sideLabel(s)}
          </Button>
        </Tooltip>
      ))}
    </ButtonGroup>
  );

  return (
    <ThemeProvider
      theme={theme}
      brand="bridge"
      density="compact"
      className={styles.anchor}
      data-bridge-toolbar=""
      {...{ [PIN_ATTR]: '' }}
      data-open={open || undefined}
      data-dock={place.dock}
      style={place.lift ? { paddingBottom: `${place.lift}px` } : undefined}
    >
      {/* Before the bar in the document, so the bar paints above the outlines and the Isolate scrim. */}
      {outlinesOn && surfaces.length ? (
        <ChangeOutlines
          surfaces={surfaces}
          theme={theme}
          emphasis={emphasis ?? current}
          flash={flash}
          isolate={isolateOn}
          onShown={setShownStable}
          tip={(s) => {
            // This surface's own before and after (its computed colour), and the token whose value it now shows.
            const prop = s.props.find((p) => /^rgb/.test(p.before) && /^rgb/.test(p.after));
            const token = prop ? visiblePairs.find((p) => p.color && toHex(p.after) === toHex(prop.after) && toHex(p.before) === toHex(prop.before)) : null;
            // The role leads ("Brand primary"), the palette step comes second ("Primary 700").
            const name = token?.token.name ?? [...new Set(s.roots.map(nameOf))].slice(0, 2).join(', ');
            // Changes tried together: the change the value comes from, by the matched token, else by the surface's roots.
            const rootsFrom = [...new Set(s.roots.flatMap((r) => (facts?.tokens.find((t) => t.cssVar === r) as { from?: number[] } | undefined)?.from ?? []))];
            const fromLine = fromOf(token) ?? (tg && rootsFrom.length ? fromText(rootsFrom, titleOf) : null);
            return (
              <span className={styles.tip}>
                {prop ? splitOf(prop.before, prop.after) : null}
                <span className={styles.tipText}>
                  <span>
                    {s.label}: {name}
                    {prop ? `, ${hexPair(prop.before, prop.after)}` : ''}
                  </span>
                  {token?.token.step ? <span className={styles.tipStep}>{token.token.step}</span> : null}
                  {fromLine ? <span className={styles.tipStep}>{fromLine.charAt(0).toUpperCase() + fromLine.slice(1)}</span> : null}
                </span>
                {prop ? subtleOf(prop.before, prop.after) : null}
              </span>
            );
          }}
        />
      ) : null}
      <div
        ref={root}
        className={open ? styles.panel : styles.pill}
        role="region"
        aria-label={`Bridge: ${label}, ${title}`}
        data-side={side}
        data-diff-ms={outlinesOn ? diff?.ms : undefined}
        data-diff-count={shownCount ?? undefined}
        data-diff-total={total ?? undefined}
        data-diff-elements={outlinesOn ? diff?.elements.length : undefined}
        data-note={note ? '' : undefined}
        style={drag ? { transform: `translateX(${drag}px)` } : undefined}
        data-dragging={drag !== null || undefined}
      >
        {open ? (
          <>
            <Tooltip className={PIN_CLASS} content="Drag, or use the arrow keys, to move the toolbar">
              <IconButton
                icon={GripVertical}
                size="md"
                label={`Move the toolbar, now ${dock === 'start' ? 'left' : dock === 'end' ? 'right' : 'centred'}. Use the left and right arrow keys.`}
                className={styles.grip}
                onKeyDown={onGripKey}
                onPointerDown={onGripDown}
                onPointerMove={onGripMove}
                onPointerUp={onGripUp}
                onPointerCancel={() => setDrag(null)}
              />
            </Tooltip>
            <p className={styles.title}>
              <span className={styles.brand}>Bridge</span>
              <span className={styles.name} title={title}>
                {title}
              </span>
            </p>
            {sides}
            {nav}
            <div className={styles.actions}>
              <Popover open={sheetOpen} onOpenChange={setSheetOpen}>
                <PopoverTrigger
                  render={
                    phone ? (
                      <IconButton icon={ListChecks} size="md" variant="ghost" label="Changes, screens and tokens" />
                    ) : (
                      <Button variant="ghost" size="md" iconEnd={ChevronUp} />
                    )
                  }
                >
                  {phone ? null : (
                    <>
                      Changes
                    </>
                  )}
                </PopoverTrigger>
                <PopoverContent side="top" align="center" className={`${styles.sheet} ${PIN_CLASS}`} aria-label="Changes">
                  {tg && T?.list ? (
                    <section className={styles.sheetSection} aria-label="Changes tried together">
                      <p className={styles.sectionTitle}>Changes tried together</p>
                      <p className={styles.note}>{TOGETHER_HINT}</p>
                      <ul className={styles.list}>
                        {T.list.map((f) => {
                          const can = f.mode === 'tokens' && Boolean(f.source);
                          const on = T.included.includes(f.number);
                          // Its tokens; those another change sets here (a pick in Studio) say which; and whether any shows in
                          // this theme and brand (a light-only change shows nothing in dark).
                          const paths = T.editedBy.get(f.number) ?? [];
                          const byOther = [...new Set(paths.flatMap((p) => T.result?.tokens.find((t) => t.path === p && !t.from.includes(f.number))?.from ?? []))];
                          const used = paths.length - paths.filter((p) => T.result?.tokens.some((t) => t.path === p && !t.from.includes(f.number))).length;
                          const showsHere = T.pairs.some((p) => p.token.from.includes(f.number));
                          const what = !on
                            ? `#${f.number}, switched off`
                            : used === 0 && byOther.length
                              ? `#${f.number}, ${paths.length === 1 ? 'its token is' : `its ${paths.length} tokens are`} set by ${byOther.map((x) => `#${x}`).join(' and ')} here (your pick)`
                              : `#${f.number}, ${used} of ${paths.length} ${paths.length === 1 ? 'token' : 'tokens'} used${byOther.length ? `, the rest set by ${byOther.map((x) => `#${x}`).join(' and ')} (your pick)` : ''}${showsHere ? '' : `. Nothing of it shows in ${theme}`}`;
                          return (
                            <li key={f.number} className={styles.item}>
                              <Checkbox
                                label={f.title}
                                description={can ? what : `#${f.number}. It changes code, so it can't be applied here.`}
                                checked={T.included.includes(f.number)}
                                disabled={!can}
                                onCheckedChange={(on) => T.toggle(f.number, on)}
                              />
                            </li>
                          );
                        })}
                      </ul>
                      {T.result?.unpicked.length ? (
                        <p className={styles.note}>
                          {T.result.unpicked.join(', ')}: the change you picked in Studio is off, so the first one listed sets {T.result.unpicked.length === 1 ? 'it' : 'them'}.
                        </p>
                      ) : null}
                    </section>
                  ) : null}
                  {outlinesOn && shownSurfaces.length ? (
                    <section className={styles.sheetSection} aria-label={`Changed here, ${shownSurfaces.length}`}>
                      <p className={styles.sectionTitle}>Changed here · {shownSurfaces.length}</p>
                      <ul className={styles.rows}>
                        {shownSurfaces.map(({ s: x, i }) => (
                          <li key={i}>
                            <Button
                              variant="ghost"
                              size="md"
                              fullWidth
                              className={styles.row}
                              data-emphasis={emphasis === i || undefined}
                              onMouseEnter={() => setEmphasis(i)}
                              onMouseLeave={() => setEmphasis((e) => (e === i ? null : e))}
                              onFocus={() => setEmphasis(i)}
                              onBlur={() => setEmphasis((e) => (e === i ? null : e))}
                              onClick={() => focusSurface(i)}
                            >
                              <span className={styles.rowText}>
                                <span className={styles.rowName}>{x.label}</span>
                                <span className={styles.rowMeta}>{tokensOf(x)}</span>
                              </span>
                            </Button>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ) : null}
                  {screens && screens.length ? (
                    <section className={styles.sheetSection} aria-label="Screens this change affects">
                      <p className={styles.sectionTitle}>Screens this change affects</p>
                      {shared ? (
                        <p className={styles.note}>
                          {shopOf(shared.tenant)}, {shared.theme}
                        </p>
                      ) : null}
                      <ul className={styles.list}>
                        {screens.map((sc) => {
                          const current = isHere(sc);
                          const where = shared ? null : <span className={styles.meta}> {shopOf(sc.tenant)}, {sc.theme}</span>;
                          return (
                            <li key={`${sc.route}|${sc.tenant}|${sc.theme}`} className={styles.item} aria-current={current ? 'page' : undefined}>
                              {current ? (
                                <span className={styles.here}>
                                  <Icon icon={Check} size="sm" />
                                  {sc.label}
                                  {where}
                                </span>
                              ) : (
                                <Link
                                  variant="standalone"
                                  href={screenHref(sc)}
                                  onClick={goTo(sc)}
                                  className={styles.screenLink}
                                >
                                  {sc.label}
                                  {where}
                                </Link>
                              )}
                              <span className={styles.meta}>{current ? 'You are here' : `${Math.max(1, Math.round(sc.percent))}% changed`}</span>
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  ) : null}
                  {visiblePairs.length ? (
                    <section className={styles.sheetSection} aria-label="Tokens this change edits">
                      <p className={styles.sectionTitle}>Tokens</p>
                      <ul className={styles.list}>
                        {roleGroups.map((g) => (
                          <li key={g.name} className={styles.item}>
                            <span className={styles.rowText}>
                              <span>{g.name}</span>
                              <span className={styles.rowMeta}>
                                {g.pairs.length === 1 ? [g.pairs[0]!.token.step, g.pairs[0]!.color ? hexPair(g.pairs[0]!.before, g.pairs[0]!.after) : `${g.pairs[0]!.before} → ${g.pairs[0]!.after}`].filter(Boolean).join(', ') : `${g.pairs.length} steps`}
                                {isSubtle(g.pairs[0]!.before, g.pairs[0]!.after) ? ', subtle change' : ''}
                              </span>
                            </span>
                            {g.pairs[0]!.color ? splitOf(g.pairs[0]!.before, g.pairs[0]!.after) : null}
                          </li>
                        ))}
                      </ul>
                    </section>
                  ) : null}
                  {behind ? (
                    <p className={styles.notice} role="note">
                      <Icon icon={Info} size="sm" />
                      {behind}
                    </p>
                  ) : null}
                  <div className={styles.sheetPhone}>
                    <Link variant="standalone" href={studio} className={styles.back}>
                      Back to Studio
                    </Link>
                  </div>
                  {screens === null ? (
                    <p className={`${styles.note} ${styles.sheetFoot}`}>
                      {tg
                        ? facts
                          ? 'Screens are measured per change, not for this mix. Show what changed outlines this screen.'
                          : 'Reading the changes.'
                        : facts
                          ? 'The screens this change affects are not measured yet.'
                          : 'Reading the change.'}
                    </p>
                  ) : screens.length === 0 ? (
                    <p className={`${styles.note} ${styles.sheetFoot}`}>No admin screen changes. Component examples may still change: Studio lists them.</p>
                  ) : null}
                </PopoverContent>
              </Popover>
              <Button variant="ghost" size="md" render={<a href={studio} />} className={styles.studio}>
                Back to Studio
              </Button>
            </div>
            <Tooltip className={PIN_CLASS} content="Collapse">
              <IconButton icon={Minimize2} size="md" label="Collapse the Bridge toolbar" className={styles.collapse} onClick={() => toggleOpen(false)} />
            </Tooltip>
            {error ? (
              <p className={styles.noteRow} role="status">
                {tg ? 'Could not read these changes. Reload the page to try again.' : 'Could not read this change. Reload the page to try again.'}
              </p>
            ) : null}
          </>
        ) : (
          <>
            <span className={styles.brand}>Bridge</span>
            <span className={styles.pillTitle} title={title}>
              {title}
            </span>
            <Badge size="sm">{label}</Badge>
            <Tooltip className={PIN_CLASS} content="Open the toolbar">
              <IconButton icon={ChevronUp} size="md" label={`Open the Bridge toolbar. Showing ${label.toLowerCase()}. Press B to flip.`} onClick={() => toggleOpen(true)} />
            </Tooltip>
          </>
        )}
        {note && <div className={styles.noteRow}>{note}</div>}
      </div>
    </ThemeProvider>
  );
}

/** A media query, kept in sync. */
function useMedia(query: string): boolean {
  const get = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false);
  const [match, setMatch] = useState(get);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setMatch(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return match;
}

/** The product's hash route ("/orders/12"), kept in sync. */
function useHash(): string {
  const read = () => window.location.hash.replace(/^#/, '').split('?')[0] || '/';
  const [hash, setHash] = useState(read);
  useEffect(() => {
    const on = () => setHash(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}
