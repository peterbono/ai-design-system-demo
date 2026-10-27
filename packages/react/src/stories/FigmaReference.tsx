import { Component, Fragment, useEffect, useRef, type ComponentType, type ElementType, type ReactNode } from 'react';
import { icons } from 'lucide-react';
import * as DS from '../index';
import type { ToastProps } from '../components/Toast';

// Hidden fixture for the Figma fidelity check (bridge figma-references): renders one generated Figma variant from
// code, with the same props, texts, icons, state and width as the variant the DS Bridge plugin draws. The capture
// passes the render plan (planReference in @bridge-ds/core) as a JSON string arg over the Storybook channel.
// Not in the sidebar, not a workbench story. The story is FigmaReference.stories.tsx; this file holds the renderer so
// it can be tested.

/** An element of a code example (a table row, a form field): component, props, children. */
interface ExampleNode {
  c: string;
  p?: Record<string, unknown>;
  children?: (string | ExampleNode)[];
}

interface Render {
  component: string;
  props: Record<string, unknown>;
  text?: string;
  parts?: { component: string; text: string }[];
  icons?: Record<string, string>;
  pseudo?: 'hover' | 'active' | 'focus-visible';
  width?: string;
  children?: (string | ExampleNode)[];
  within?: string;
  popup?: { className: string };
}

const lucide = icons as Record<string, unknown>;

/**
 * A toast is shown from the useToast hook under its provider, not placed: shown once, and marked as the capture target
 * (`data-fidelity-target`) where Base UI renders it, at the bottom end of the screen.
 */
function ToastReference(props: Record<string, unknown>) {
  return (
    <DS.ToastProvider>
      <ShowToast toast={{ ...(props as unknown as ToastProps), timeout: 0 }} />
    </DS.ToastProvider>
  );
}
function ShowToast({ toast }: { toast: ToastProps }) {
  const api = DS.useToast();
  const shown = useRef(false);
  useEffect(() => {
    if (shown.current) return;
    shown.current = true;
    api.add(toast);
    const mark = () => {
      const el = document.querySelector('[role="dialog"][data-type], [role="alertdialog"][data-type]');
      if (el) el.setAttribute('data-fidelity-target', '');
      else requestAnimationFrame(mark);
    };
    mark();
  }, [api, toast]);
  return null;
}

/** Components shown from a hook rather than placed (drafted sets): rendered through their hook. */
const HOOK_SHOWN: Record<string, ComponentType<Record<string, unknown>>> = { Toast: ToastReference };

const registry = { ...(DS as unknown as Record<string, ComponentType<Record<string, unknown>> | undefined>), ...HOOK_SHOWN };

/**
 * Marks the element just before it as the capture target (`data-fidelity-target`): a part rendered inside its parent
 * is captured alone, at the width Figma draws it (the parent's padding and border do not count). A `<template>` is
 * valid in any parent (a table body, a list) and draws nothing.
 */
function MarkPrevious({ width }: { width: string | undefined }) {
  const ref = useRef<HTMLTemplateElement>(null);
  useEffect(() => {
    let frame = 0;
    const mark = () => {
      const el = ref.current?.previousElementSibling;
      if (!el) {
        frame = requestAnimationFrame(mark);
        return;
      }
      if (width && el instanceof HTMLElement) el.style.width = width;
      el.setAttribute('data-fidelity-target', '');
    };
    mark();
    return () => cancelAnimationFrame(frame);
  }, [width]);
  return <template ref={ref} data-fidelity-anchor="" />;
}

/**
 * Marks the popup a component renders open (a dialog, a select's list, a tooltip) as the capture target: Base UI portals
 * it out of the story root, so it is found by its CSS module class (`_popup_<hash>`), once it is placed and visible.
 */
function MarkPopup({ className }: { className: string }) {
  useEffect(() => {
    const own = new RegExp(`^_?${className.replace(/[^\w-]/g, '')}(_|$)`);
    let frame = 0;
    const mark = () => {
      const el = [...document.querySelectorAll('body *')].find(
        (e) => !e.closest('[data-fidelity-root]') && [...e.classList].some((c) => own.test(c)) && e.getBoundingClientRect().width > 0,
      );
      if (el) el.setAttribute('data-fidelity-target', '');
      else frame = requestAnimationFrame(mark);
    };
    mark();
    return () => cancelAnimationFrame(frame);
  }, [className]);
  return null;
}

/**
 * How a part of a compound component is hosted (keyed by the parent's export name): the props the part gets, and the
 * parent elements around it. A parent without an entry is rendered as is around the part.
 */
interface Host {
  part?: (component: string, props: Record<string, unknown>) => Record<string, unknown>;
  wrap: (part: ReactNode, props: Record<string, unknown>, component: string) => ReactNode;
}

const withoutChecked = ({ checked: _checked, ...rest }: Record<string, unknown>) => rest;

const HOSTS: Record<string, Host> = {
  // A radio is checked by its group's value.
  RadioGroup: {
    part: (_c, p) => withoutChecked(p),
    wrap: (part, p) => (
      <DS.RadioGroup label="Options" hideLabel value={p.checked ? String(p.value) : ''}>
        {part}
      </DS.RadioGroup>
    ),
  },
  // Menu parts render in an open menu; a radio item is checked by its group's value. The popup shows once it is placed
  // against its trigger, so the menu has one (not captured), and it grows past its max width to fit the part at the
  // width Figma draws it.
  Menu: {
    part: (c, p) => (c === 'MenuRadioItem' ? { value: 'item', ...withoutChecked(p) } : p),
    wrap: (part, p, c) => (
      <DS.Menu open>
        <DS.MenuTrigger aria-label="Menu" />
        <DS.MenuContent style={{ maxWidth: 'none' }}>
          {c === 'MenuRadioItem' ? <DS.MenuRadioGroup value={p.checked ? String(p.value ?? 'item') : ''}>{part}</DS.MenuRadioGroup> : part}
        </DS.MenuContent>
      </DS.Menu>
    ),
  },
  SidebarNav: {
    wrap: (part, _p, c) => <DS.SidebarNav>{c === 'SidebarNavItem' ? <DS.SidebarNavSection>{part}</DS.SidebarNavSection> : part}</DS.SidebarNav>,
  },
  Table: {
    wrap: (part) => (
      <DS.Table aria-label="Table">
        <DS.TableBody>{part}</DS.TableBody>
      </DS.Table>
    ),
  },
};

/**
 * A component that throws (a part rendered without its parent, a missing context) shows its error as the skip reason
 * instead of breaking the story: keyed by the plan, so the next variant renders fresh.
 */
class RenderBoundary extends Component<{ component: string; children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override render() {
    if (this.state.error) return <p data-fidelity-error="">{`${this.props.component} threw while rendering: ${this.state.error.message}`}</p>;
    return this.props.children;
  }
}

/** Icon props given by name ("Pencil") become the lucide icon. */
function withIcons(p: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = { ...p };
  for (const [k, v] of Object.entries(out)) if (/^icon/i.test(k) && typeof v === 'string' && lucide[v]) out[k] = lucide[v];
  return out;
}

/**
 * Lowercase names are HTML elements, as in JSX (a list, a paragraph in a dialog's example), never design system exports.
 * Elements that run or embed other content are left out.
 */
const INTRINSIC = /^[a-z][a-z0-9]*$/;
const UNSAFE_INTRINSIC = new Set(['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'frame', 'frameset']);

/**
 * A code example's children: texts as they are, HTML elements as they are, components through the design system.
 * Missing names throw. A single child is returned alone, not in a list: a component that takes one element (a
 * tooltip's trigger) cannot take a list of one.
 */
function example(nodes: (string | ExampleNode)[]): ReactNode {
  const out = nodes.map((n, i) => {
    if (typeof n === 'string') return n;
    if (INTRINSIC.test(n.c)) {
      if (UNSAFE_INTRINSIC.has(n.c)) throw new Error(`<${n.c}> is not drawn from an example`);
      const Tag = n.c as ElementType;
      return (
        <Tag key={i} {...(n.p as Record<string, unknown>)}>
          {n.children?.length ? example(n.children) : undefined}
        </Tag>
      );
    }
    const Comp = registry[n.c];
    if (!Comp) throw new Error(`${n.c} is not exported by @bridge-ds/react`);
    return (
      <Comp key={i} {...withIcons(n.p)}>
        {n.children?.length ? example(n.children) : undefined}
      </Comp>
    );
  });
  return out.length === 1 ? out[0] : out;
}

function Reference({ r, plan }: { r: Render; plan: string }) {
  const Comp = registry[r.component];
  if (!Comp) return <p data-fidelity-error="">{`${r.component} is not exported by @bridge-ds/react`}</p>;
  const Parent = r.within ? registry[r.within] : undefined;
  if (r.within && !Parent) return <p data-fidelity-error="">{`${r.within} is not exported by @bridge-ds/react`}</p>;
  const props: Record<string, unknown> = withIcons(r.props);
  for (const [prop, name] of Object.entries(r.icons ?? {})) {
    if (!lucide[name]) return <p data-fidelity-error="">{`Icon ${name} is not in lucide-react`}</p>;
    props[prop] = lucide[name];
  }
  // Icon-only components need an accessible name; it is not drawn.
  if (r.icons && r.text === undefined && !r.parts && !r.children) props.label = r.component;
  let children: ReactNode = r.text;
  if (r.children) {
    try {
      children = example(r.children);
    } catch (err) {
      return <p data-fidelity-error="">{(err as Error).message}</p>;
    }
  } else if (r.parts) {
    const missing = r.parts.find((p) => !registry[p.component]);
    if (missing) return <p data-fidelity-error="">{`${missing.component} is not exported by @bridge-ds/react`}</p>;
    children = r.parts.map((p) => {
      const Part = registry[p.component]!;
      return <Part key={p.component}>{p.text}</Part>;
    });
  }
  const width = r.width ? `var(--${r.width.split('.').join('-')})` : undefined;
  let content: ReactNode = <Comp {...props}>{children}</Comp>;
  // A part of a compound component renders inside its parent and is captured alone (marked by MarkPrevious).
  if (r.within && Parent) {
    const host: Host = HOSTS[r.within] ?? { wrap: (part) => <Parent>{part}</Parent> };
    const partProps = host.part ? host.part(r.component, props) : props;
    content = host.wrap(
      <>
        <Comp {...partProps}>{children}</Comp>
        <MarkPrevious width={width} />
      </>,
      props,
      r.component,
    );
  }
  // A popup drawn open: the root renders open, and the portaled popup is the image (not the trigger).
  if (r.popup) content = [<Fragment key="content">{content}</Fragment>, <MarkPopup key="popup" className={r.popup.className} />];
  // pseudo-states addon classes: every descendant behaves as hovered, pressed or focused.
  const pseudo = r.pseudo ? `pseudo-${r.pseudo}-all` : undefined;
  // The width goes to the part itself when it sits in a parent; the parent sizes around it.
  return (
    <div key={plan} data-fidelity-root="" className={pseudo} style={{ display: 'inline-block', width: r.within ? undefined : width }}>
      {content}
    </div>
  );
}

export function FigmaReference({ plan }: { plan: string }) {
  let r: Render;
  try {
    r = JSON.parse(plan) as Render;
  } catch {
    return <p data-fidelity-error="">No render plan</p>;
  }
  return (
    <RenderBoundary key={plan} component={r.component}>
      <Reference r={r} plan={plan} />
    </RenderBoundary>
  );
}
