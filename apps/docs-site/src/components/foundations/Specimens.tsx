// Specimens of the Library foundation pages: each token group shown in context, with the real Bridge components where
// one exists and token-only CSS otherwise (styles/foundations.css, .sp-*). The Library views render one panel per
// theme inside data-theme (components/ds/library/FoundationParts.tsx SpecimenPair), so real tokens resolve and the
// brand follows the preview switch in the specimen header. Hover and pressed states reuse each component's own state
// variables (--_bg-hover, --_bg-active), so a static state shows exactly what the pointer would.
import type { CSSProperties, ReactNode } from 'react';
import { Check } from 'lucide-react';
import { Alert, Badge, Button, Checkbox, Input, Kbd, Progress, Switch, Tag } from '@bridge-ds/react';

export type SpecimenGroup =
  | 'color.bg'
  | 'color.surface'
  | 'color.text'
  | 'color.border'
  | 'color.action'
  | 'color.control'
  | 'color.signal'
  | 'color.overlay'
  | 'color.feedback'
  | 'color.selection'
  | 'focus'
  | 'elevation';

type Mode = 'light' | 'dark';

/**
 * Token caption inside a specimen: names the token that paints the area it sits on, in the system's mono face.
 * Not a DS Tag: it has no fill of its own, so the surface under it stays the thing being shown.
 */
function TokenCaption({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`sp-tag ${className}`.trim()}>{children}</span>;
}

const HOVER: CSSProperties = { backgroundColor: 'var(--_bg-hover)' };
const PRESSED: CSSProperties = { backgroundColor: 'var(--_bg-active)' };

function Backgrounds() {
  return (
    <div className="sp-bg-canvas">
      <TokenCaption>bg.default</TokenCaption>
      <div className="sp-bg-subtle">
        <TokenCaption>bg.subtle</TokenCaption>
        <div className="sp-bg-code" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="sp-bg-muted">
          <TokenCaption>bg.muted</TokenCaption>
          <span className="sp-bg-track" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}

function Surfaces() {
  const rows: [string, string, boolean?][] = [
    ['Default', 'surface.default'],
    ['Hover', 'surface.hover'],
    ['Pressed', 'surface.pressed'],
    ['Selected', 'surface.selected', true],
  ];
  return (
    <div className="sp-stage">
      <div className="sp-surface-card">
        {rows.map(([label, token, selected]) => (
          <div key={token} className={`sp-surface-row is-${label.toLowerCase()}`}>
            <span className="sp-surface-label">
              {selected && <Check size={14} strokeWidth={1.75} aria-hidden="true" />}
              {label}
            </span>
            <TokenCaption>{token}</TokenCaption>
          </div>
        ))}
      </div>
      <div className="sp-surface-float">
        <div className="sp-surface-raised">
          <span>Raised</span>
          <TokenCaption>surface.raised</TokenCaption>
        </div>
        <div className="sp-surface-inverse">
          <span>Inverse</span>
          <TokenCaption className="is-inverse">surface.inverse</TokenCaption>
        </div>
      </div>
    </div>
  );
}

function Texts() {
  return (
    <div className="sp-stage">
      <div className="sp-text-card">
        <p className="sp-text is-default">
          Approve the token change <TokenCaption>text.default</TokenCaption>
        </p>
        <p className="sp-text is-muted">
          Edited 2 hours ago by Florian <TokenCaption>text.muted</TokenCaption>
        </p>
        <p className="sp-text is-disabled">
          Not available in compact density <TokenCaption>text.disabled</TokenCaption>
        </p>
        <p className="sp-text">
          <span className="sp-link">Read the contrast rules</span> <span className="sp-link is-hover">on hover</span> <TokenCaption>text.link</TokenCaption>
        </p>
        <p className="sp-text is-signal">
          3 matches in this file <TokenCaption>text.signal</TokenCaption>
        </p>
      </div>
      <div className="sp-text-on">
        <span className="sp-text-inverse">Inverse text</span>
        <span className="sp-text-solid">On solid</span>
      </div>
    </div>
  );
}

function Borders() {
  return (
    <div className="sp-stage sp-border-grid">
      <div className="sp-border-box is-default">
        <TokenCaption>border.default</TokenCaption>
        <span className="sp-muted">Card edge</span>
      </div>
      <div className="sp-border-box is-list">
        <span>Row one</span>
        <span>Row two</span>
        <TokenCaption>border.subtle</TokenCaption>
      </div>
      <div className="sp-border-field is-strong">
        <span className="sp-muted">Control edge</span>
        <TokenCaption>border.strong</TokenCaption>
      </div>
      <div className="sp-border-field is-hover">
        <span className="sp-muted">On hover</span>
        <TokenCaption>border.hover</TokenCaption>
      </div>
    </div>
  );
}

function Actions() {
  const variants: { v: 'primary' | 'secondary' | 'ghost' | 'danger'; label: string }[] = [
    { v: 'primary', label: 'Publish' },
    { v: 'secondary', label: 'Preview' },
    { v: 'ghost', label: 'Cancel' },
    { v: 'danger', label: 'Delete' },
  ];
  return (
    <div className="sp-stage">
      <div className="sp-action-grid" role="table" aria-label="Buttons by variant and state">
        <div role="row" className="sp-action-row is-head">
          <span role="columnheader" className="sp-muted">
            Rest
          </span>
          <span role="columnheader" className="sp-muted">
            Hover
          </span>
          <span role="columnheader" className="sp-muted">
            Pressed
          </span>
        </div>
        {variants.map(({ v, label }) => (
          <div role="row" className="sp-action-row" key={v}>
            <span role="rowheader">
              <TokenCaption>action.{v}</TokenCaption>
            </span>
            <span role="cell">
              <Button variant={v} size="sm" tabIndex={-1}>
                {label}
              </Button>
            </span>
            <span role="cell">
              <Button variant={v} size="sm" tabIndex={-1} style={HOVER}>
                {label}
              </Button>
            </span>
            <span role="cell">
              <Button variant={v} size="sm" tabIndex={-1} style={PRESSED}>
                {label}
              </Button>
            </span>
          </div>
        ))}
        <div role="row" className="sp-action-row">
          <span role="rowheader">
            <TokenCaption>action.disabled</TokenCaption>
          </span>
          <span role="cell">
            <Button size="sm" disabled>
              Publish
            </Button>
          </span>
        </div>
      </div>
    </div>
  );
}

function Controls({ mode }: { mode: Mode }) {
  return (
    <div className="sp-stage sp-control-grid">
      <Checkbox label="Include dark theme" defaultChecked id={`sp-cb-on-${mode}`} />
      <Checkbox label="Include compact density" id={`sp-cb-off-${mode}`} />
      <Switch label="Sync from Figma" defaultChecked id={`sp-sw-on-${mode}`} />
      <Switch label="Auto-merge" id={`sp-sw-off-${mode}`} />
      <TokenCaption>control.checked · control.track · control.thumb</TokenCaption>
    </div>
  );
}

function Signals() {
  return (
    <div className="sp-stage sp-signal">
      <div className="sp-tabs" aria-hidden="true">
        <span className="is-current">Tokens</span>
        <span>Components</span>
        <span>History</span>
      </div>
      <Progress value={64} label="Publishing tokens" showValue />
      <p className="sp-text">
        Search: <mark className="sp-mark">bg</mark>.default <TokenCaption>signal.subtle · text.signal</TokenCaption>
      </p>
      <TokenCaption>signal.default</TokenCaption>
    </div>
  );
}

function Overlays() {
  return (
    <div className="sp-overlay">
      <div className="sp-overlay-page" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className="sp-overlay-scrim">
        <div className="sp-overlay-dialog">
          <strong>Delete 3 tokens?</strong>
          <span className="sp-muted">Components that use them fall back to their defaults.</span>
        </div>
        <TokenCaption className="is-inverse sp-overlay-tag">overlay.scrim</TokenCaption>
      </div>
    </div>
  );
}

function Feedback() {
  return (
    <div className="sp-stage sp-feedback">
      <Alert tone="info" title="Figma changes arrive as a pull request" announce="off" />
      <Alert tone="success" title="Contrast checks pass" announce="off" />
      <Alert tone="warning" title="Unused tokens show up in Checks" announce="off" />
      <Alert tone="danger" title="A failing contrast pair blocks the release" announce="off" />
      <div className="sp-badges">
        <Badge tone="info">Info</Badge>
        <Badge tone="success">Passed</Badge>
        <Badge tone="warning">Review</Badge>
        <Badge tone="danger">Failed</Badge>
      </div>
      <div className="sp-badges">
        <Badge tone="info" appearance="solid">
          Info
        </Badge>
        <Badge tone="success" appearance="solid">
          Passed
        </Badge>
        <Badge tone="warning" appearance="solid">
          Review
        </Badge>
        <Badge tone="danger" appearance="solid">
          Failed
        </Badge>
      </div>
    </div>
  );
}

function Selection() {
  return (
    <div className="sp-stage">
      <p className="sp-text sp-reading">
        Semantic tokens give each color a job. <span className="sp-selected">Design and build with semantic tokens only</span>, so a brand can
        repaint every screen at once.
      </p>
      <TokenCaption>selection.bg</TokenCaption>
    </div>
  );
}

function Focus({ mode }: { mode: Mode }) {
  return (
    <div className="sp-stage sp-focus">
      <div className="sp-focus-input">
        <Input label="Token name" defaultValue="color.bg.canvas" id={`sp-focus-${mode}`} />
      </div>
      <div className="sp-focus-row">
        <Button variant="secondary" size="sm" className="sp-focus-ring" tabIndex={-1}>
          Preview
        </Button>
        <TokenCaption>focus.ring.color · width · offset</TokenCaption>
      </div>
    </div>
  );
}

function Elevation() {
  const levels: [string, string, string][] = [
    ['Flat', 'is-flat', 'no shadow'],
    ['Raised', 'is-raised', 'elevation.raised'],
    ['Overlay', 'is-overlay', 'elevation.overlay'],
    ['Modal', 'is-modal', 'elevation.modal'],
  ];
  return (
    <div className="sp-elevation">
      {levels.map(([label, cls, token]) => (
        <div className={`sp-lift ${cls}`} key={cls}>
          <strong>{label}</strong>
          <TokenCaption>{token}</TokenCaption>
        </div>
      ))}
    </div>
  );
}

export default function Specimen({ group, mode }: { group: SpecimenGroup; mode: Mode }) {
  switch (group) {
    case 'color.bg':
      return <Backgrounds />;
    case 'color.surface':
      return <Surfaces />;
    case 'color.text':
      return <Texts />;
    case 'color.border':
      return <Borders />;
    case 'color.action':
      return <Actions />;
    case 'color.control':
      return <Controls mode={mode} />;
    case 'color.signal':
      return <Signals />;
    case 'color.overlay':
      return <Overlays />;
    case 'color.feedback':
      return <Feedback />;
    case 'color.selection':
      return <Selection />;
    case 'focus':
      return <Focus mode={mode} />;
    case 'elevation':
      return <Elevation />;
  }
}

/** A real composition with its spacing made visible: tinted padding and gaps, named in the legend below it. */
export function LayoutSpecimen() {
  return (
    <div className="sp-layout">
      <div className="sp-layout-card">
        <div className="sp-layout-inner">
          <div className="sp-layout-head">
            <strong className="sp-layout-title">Soften the page background</strong>
            <Badge tone="info">In review</Badge>
          </div>
          <p className="sp-layout-body">A proposed change to color.bg.default. Check the contrast pairs before you approve it.</p>
          <div className="sp-layout-actions">
            <Button size="sm" tabIndex={-1}>
              Approve change
            </Button>
            <Button size="sm" variant="secondary" tabIndex={-1}>
              Request changes
            </Button>
          </div>
        </div>
      </div>
      <ul className="sp-layout-legend">
        <li>
          <i className="sp-layout-key" aria-hidden="true" />
          <span>Card padding</span> <TokenCaption>layout.inset</TokenCaption>
        </li>
        <li>
          <i className="sp-layout-key" aria-hidden="true" />
          <span>Between blocks</span> <TokenCaption>layout.gap</TokenCaption>
        </li>
        <li>
          <i className="sp-layout-key" aria-hidden="true" />
          <span>Title to badge, between buttons</span> <TokenCaption>control.gap</TokenCaption>
        </li>
      </ul>
    </div>
  );
}

/** Each radius role on the objects that use it: rank, not one value. */
export function RadiusSpecimen() {
  return (
    <div className="sp-radius">
      <div className="sp-radius-col">
        <span className="sp-radius-shape is-inset" aria-hidden="true" />
        <div className="sp-radius-demo">
          <Checkbox label="Box" defaultChecked />
          <Tag>Tag</Tag>
          <Kbd keys="K" />
        </div>
        <TokenCaption>radius.inset</TokenCaption>
      </div>
      <div className="sp-radius-col">
        <span className="sp-radius-shape is-control" aria-hidden="true" />
        <div className="sp-radius-demo">
          <Button size="sm" tabIndex={-1}>
            Publish
          </Button>
        </div>
        <TokenCaption>radius.control</TokenCaption>
      </div>
      <div className="sp-radius-col">
        <span className="sp-radius-shape is-container" aria-hidden="true" />
        <div className="sp-radius-demo">
          <span className="sp-radius-card">Card</span>
        </div>
        <TokenCaption>radius.container</TokenCaption>
      </div>
      <div className="sp-radius-col">
        <span className="sp-radius-shape is-overlay" aria-hidden="true" />
        <div className="sp-radius-demo">
          <span className="sp-radius-dialog">Dialog</span>
        </div>
        <TokenCaption>radius.overlay</TokenCaption>
      </div>
      <div className="sp-radius-col">
        <span className="sp-radius-shape is-pill" aria-hidden="true" />
        <div className="sp-radius-demo">
          <Badge tone="success">Passed</Badge>
          <Switch label="Sync" defaultChecked />
        </div>
        <TokenCaption>radius.pill</TokenCaption>
      </div>
    </div>
  );
}
