// The Bridge toolbar: opened from Bridge Studio ("Try it in the product") with `?bridge=<change>`, it lets a designer
// browse the real admin and flip between the live product and this change. Token changes swap the live tokens in
// without a reload; code changes move between the production admin and the change's preview on the same screen.
// Production renders nothing on its own. It opens collapsed, bottom right of the content column, and moves away from
// the page's primary and submit buttons.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Badge, Button, ButtonGroup, Icon, IconButton, Link, Popover, PopoverContent, PopoverTrigger, ThemeProvider, Tooltip, VisuallyHidden } from '@bridge-ds/react';
import { ArrowRight, Check, ChevronUp, GripVertical, Minimize2 } from 'lucide-react';
import { usePreferences } from '../preferences';
import { isTenantId, TENANT_LIST, TENANTS } from '../tenants';
import { loadChange, type ChangeFacts } from './github';
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
  readChange,
  readDock,
  readReturn,
  readScroll,
  sameScreenOn,
  SCROLL_PARAM,
  shouldRender,
  stepDock,
  studioChangeUrl,
  toHex,
  whereAmI,
  type BridgeBuild,
  type Dock,
  type NoDifference,
  type Rect,
  type Screen,
  type TokenChange,
} from './session';
import styles from './BridgeToolbar.module.css';

declare const __BRIDGE_BUILD__: BridgeBuild;

type Side = 'before' | 'after';
type TokenState = 'idle' | 'loading' | 'ready' | 'error';

/** The two sides, in the words designers use. */
const SIDE_LABEL: Record<Side, string> = { before: 'Live product', after: 'This change' };
/** Token pairs shown on the toolbar; the rest is "+N". */
const MAX_PAIRS = 3;

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

/** Mounted once at the app root. Decides on first render whether there is anything to show. */
export function BridgeToolbar() {
  const [setup] = useState(() => {
    const build = __BRIDGE_BUILD__;
    const store = session();
    const change = readChange(window.location.search, store);
    const where = whereAmI(window.location.host, build);
    const returnTo = where === 'production' ? readReturn(window.location.search, store, build.adminTemplate) : null;
    return { build, change, where, returnTo };
  });
  if (!shouldRender(setup)) return null;
  return <Toolbar build={setup.build} change={setup.change!} onProduction={setup.where === 'production'} returnTo={setup.returnTo} />;
}

/** Live swap of the live tokens: one stylesheet after the bundled one, disabled on "This change" so flipping is instant. */
function useLiveTokens(url: string | null, on: boolean): TokenState {
  const [state, setState] = useState<TokenState>('idle');
  const link = useRef<HTMLLinkElement | null>(null);
  useEffect(() => {
    if (!on || !url) {
      if (link.current) link.current.disabled = true;
      setState('idle');
      return;
    }
    if (link.current) {
      link.current.disabled = false;
      setState('ready');
      return;
    }
    const el = document.createElement('link');
    el.rel = 'stylesheet';
    el.href = url;
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
  }, [url, on]);
  useEffect(() => () => link.current?.remove(), []);
  return state;
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

const BRAND_NAME = (brand: string) => TENANT_LIST.find((t) => t.brand === brand)?.name ?? brand;

/** "No visible difference in dark. This change is light only." */
function noDifferenceText(d: NoDifference): string {
  return d.kind === 'theme'
    ? `No visible difference in ${d.here}. This change is ${d.touched} only.`
    : `No visible difference in ${BRAND_NAME(d.here)}. This change is ${BRAND_NAME(d.touched)} only.`;
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

function Toolbar({ build, change, onProduction, returnTo }: { build: BridgeBuild; change: number; onProduction: boolean; returnTo: string | null }) {
  const { theme, set: setPrefs, tenantId, tenant } = usePreferences();
  const [facts, setFacts] = useState<ChangeFacts | null>(null);
  const [error, setError] = useState(false);
  // On production the toolbar only exists for the live side of a code change.
  const [side, setSide] = useState<Side>(onProduction ? 'before' : 'after');
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
    let live = true;
    loadChange(build, change).then(
      (f) => live && setFacts(f),
      () => live && setError(true),
    );
    return () => {
      live = false;
    };
  }, [build, change]);

  const liveUrl = facts?.mode === 'tokens' ? liveTokensUrl(build) : null;
  const tokens = useLiveTokens(liveUrl, side === 'before' && facts?.mode === 'tokens');
  const pairs = usePairs(facts, liveUrl, tenant.brand, side === 'before');
  const noDiff = facts?.mode === 'tokens' ? noVisibleDifference(facts.files, { theme, brand: tenant.brand }) : null;

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
      if (next === 'before' && build.productionAdmin) {
        window.location.assign(sameScreenOn(build.productionAdmin, here, { change, returnTo: window.location.origin, scroll: window.scrollY }));
      } else if (next === 'after' && returnTo) {
        window.location.assign(sameScreenOn(returnTo, here, { change, scroll: window.scrollY }));
      }
    },
    [side, facts, build, change, returnTo],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isFlipKey(e)) return;
      e.preventDefault();
      choose(side === 'after' ? 'before' : 'after');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [choose, side]);

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
        const gutter = window.innerWidth <= 760 ? 8 : 16;
        const next = placeToolbar({ left: area.left, right: area.right, vh: window.innerHeight, w: box.width, h: box.height, gutter, preferred: dock, obstacles: pageObstacles(el) });
        setPlace((p) => (p.dock === next.dock && p.lift === next.lift ? p : next));
        document.body.style.paddingBottom = `${box.height + 2 * gutter}px`;
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
  }, [dock, open, facts]);

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
    if (isTenantId(s.tenant) && (s.tenant !== tenantId || s.theme !== theme)) setPrefs({ tenantId: s.tenant, theme: s.theme === 'dark' ? 'dark' : 'light' });
    window.location.hash = s.route;
  };
  const fixNoDiff = () => {
    if (!noDiff) return;
    toggleOpen(true);
    if (noDiff.kind === 'theme') setPrefs({ theme: noDiff.touched === 'dark' ? 'dark' : 'light' });
    else {
      const t = TENANT_LIST.find((x) => x.brand === noDiff.touched);
      if (t) setPrefs({ tenantId: t.id });
    }
  };

  const label = SIDE_LABEL[side];
  const title = facts?.title ?? `Change ${change}`;
  const screens = facts?.screens ?? null;
  const canFlip = Boolean(facts) && (facts!.mode === 'tokens' || (side === 'after' ? Boolean(build.productionAdmin) : Boolean(returnTo)));
  const studio = studioChangeUrl(build, change);
  const behind = facts?.behind ? 'Live has moved on since this change started.' : null;
  // Screens share one shop and theme most of the time: say it once in the sheet's header.
  const shared = screens?.length && screens.every((s) => s.tenant === screens[0]!.tenant && s.theme === screens[0]!.theme) ? screens[0]! : null;
  const shopOf = (t: string) => (isTenantId(t) ? TENANTS[t].name : t);

  const note = shownIn ? (
    <p className={styles.note} role="status">
      Shown in {shownIn}. This change only affects {shownIn}.
    </p>
  ) : noDiff ? (
    <p className={styles.note} role="status">
      <span>{noDifferenceText(noDiff)}</span>
      <Button variant="ghost" size="md" onClick={fixNoDiff} className={styles.noteAction}>
        {noDiff.kind === 'theme' ? `Switch to ${noDiff.touched}` : `Switch to ${BRAND_NAME(noDiff.touched)}`}
      </Button>
    </p>
  ) : null;

  const pairList = pairs.length ? (
    <span className={styles.pairs} aria-label="Tokens this change edits">
      {pairs.slice(0, MAX_PAIRS).map((p) => {
        const before = p.color ? toHex(p.before) : p.before;
        const after = p.color ? toHex(p.after) : p.after;
        return (
          <Tooltip key={p.token.path} content={`${p.token.path}: ${before} to ${after}`}>
            <span className={styles.pair}>
              {p.color ? (
                <>
                  <span className={styles.swatch} style={{ backgroundColor: p.before }} aria-hidden="true" />
                  <Icon icon={ArrowRight} size="xs" />
                  <span className={styles.swatch} style={{ backgroundColor: p.after }} aria-hidden="true" />
                </>
              ) : null}
              <span className={styles.pairName}>{p.token.name}</span>
              <VisuallyHidden>
                , from {before} to {after}
              </VisuallyHidden>
            </span>
          </Tooltip>
        );
      })}
      {pairs.length > MAX_PAIRS && <span className={styles.more}>+{pairs.length - MAX_PAIRS}</span>}
    </span>
  ) : null;

  const sides = (
    <ButtonGroup appearance="attached" aria-label="Compare" className={styles.sides}>
      {(['before', 'after'] as const).map((s) => (
        <Tooltip key={s} content="Press B to flip">
          <Button
            variant="secondary"
            size="md"
            iconStart={side === s ? Check : undefined}
            aria-pressed={side === s}
            aria-keyshortcuts="B"
            disabled={!canFlip && side !== s}
            onClick={() => choose(s)}
          >
            {SIDE_LABEL[s]}
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
      data-dock={place.dock}
      style={place.lift ? { paddingBottom: `${place.lift}px` } : undefined}
    >
      <div
        ref={root}
        className={open ? styles.panel : styles.pill}
        role="region"
        aria-label={`Bridge: ${label}, ${title}`}
        data-side={side}
        data-note={note ? '' : undefined}
        style={drag ? { transform: `translateX(${drag}px)` } : undefined}
        data-dragging={drag !== null || undefined}
      >
        {open ? (
          <>
            <Tooltip content="Drag, or use the arrow keys, to move the toolbar">
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
            <div className={styles.actions}>
              {sides}
              <Popover>
                <PopoverTrigger render={<Button variant="ghost" size="md" iconEnd={ChevronUp} />}>
                  Screens<span className={styles.count}>{screens ? screens.length : ''}</span>
                </PopoverTrigger>
                <PopoverContent
                  side="top"
                  align="center"
                  title="Screens this changes"
                  description={shared ? `${shopOf(shared.tenant)}, ${shared.theme}` : undefined}
                  className={styles.sheet}
                >
                  {screens === null ? (
                    <p className={styles.note}>{facts ? 'Not measured yet. Studio shows the screens once the before and after has run.' : 'Reading the change.'}</p>
                  ) : screens.length === 0 ? (
                    <p className={styles.note}>No admin screen changes. Component examples may still change: Studio lists them.</p>
                  ) : (
                    <ul className={styles.list}>
                      {screens.map((s) => {
                        const current = s.route === hash && s.tenant === tenantId && s.theme === theme;
                        const where = shared ? null : <span className={styles.meta}> {shopOf(s.tenant)}, {s.theme}</span>;
                        return (
                          <li key={`${s.route}|${s.tenant}|${s.theme}`} className={styles.item} aria-current={current ? 'page' : undefined}>
                            {current ? (
                              <span className={styles.here}>
                                <Icon icon={Check} size="sm" />
                                {s.label}
                                {where}
                              </span>
                            ) : (
                              <Link
                                variant="standalone"
                                href={`?${PARAM}=${change}&tenant=${encodeURIComponent(s.tenant)}&theme=${encodeURIComponent(s.theme)}#${s.route}`}
                                onClick={goTo(s)}
                                className={styles.screenLink}
                              >
                                {s.label}
                                {where}
                              </Link>
                            )}
                            <span className={styles.meta}>{current ? 'You are here' : `${Math.max(1, Math.round(s.percent))}% changed`}</span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  <div className={styles.sheetPhone}>{pairList}</div>
                  {behind && <p className={styles.note}>{behind}</p>}
                  <div className={styles.sheetPhone}>
                    <Link variant="standalone" href={studio} className={styles.back}>
                      Back to Studio
                    </Link>
                  </div>
                </PopoverContent>
              </Popover>
              <Button variant="ghost" size="md" render={<a href={studio} />} className={styles.studio}>
                Back to Studio
              </Button>
            </div>
            <Tooltip content="Collapse">
              <IconButton icon={Minimize2} size="md" label="Collapse the Bridge toolbar" className={styles.collapse} onClick={() => toggleOpen(false)} />
            </Tooltip>
            <div className={styles.mode} role="status" aria-live="polite">
              <p className={styles.modeText}>
                {error ? (
                  'Could not read this change. Reload the page to try again.'
                ) : (
                  <>
                    <strong>{label}:</strong> {modeDetail(facts, side, tokens)} {side === 'before' && behind ? `${behind} ` : ''}
                    <span className={styles.press}>Press B to flip.</span>
                  </>
                )}
              </p>
              {pairList}
            </div>
          </>
        ) : (
          <>
            <span className={styles.brand}>Bridge</span>
            <span className={styles.pillTitle} title={title}>
              {title}
            </span>
            <Badge size="sm">{label}</Badge>
            <Tooltip content="Open the toolbar">
              <IconButton icon={ChevronUp} size="md" label={`Open the Bridge toolbar. Showing ${label.toLowerCase()}. Press B to flip.`} onClick={() => toggleOpen(true)} />
            </Tooltip>
          </>
        )}
        {note && <div className={styles.noteRow}>{note}</div>}
      </div>
    </ThemeProvider>
  );
}

/** The admin's hash route ("/orders/12"), kept in sync. */
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
