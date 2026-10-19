// @bridge-ds/react/dom: the Bridge components for pages that build markup in plain scripts (static sites, server
// templates, vanilla TypeScript), without React at runtime. Each renderer returns the exact markup its React
// component renders, with the same class names (the same CSS Modules), so it looks and behaves the same; parity
// tests guard it. Behavior that needs JavaScript is one `bind*` call per page.
//
//   import { badgeHtml, tooltipAttributes, bindTooltips } from '@bridge-ds/react/dom';
//   row.innerHTML = `${badgeHtml('Approved', { tone: 'success', attributes: tooltipAttributes('Approved by the design owner', { focusable: true }) })}`;
//   bindTooltips();
//
// Renderers are named `<component>Html` so `bridge audit` counts them as design system components.
export { escapeHtml, trusted, attrs as htmlAttributes, type HtmlAttributes, type TrustedHtml } from './html';
export { badgeHtml, badgeClassName, type BadgeHtmlOptions } from './badge';
export { tooltipAttributes, tooltipHtmlAttributes, bindTooltips, type TooltipAttributeOptions, type BindTooltipsOptions } from './tooltip';
export { codeBlockHtml, bindCodeBlocks, type CodeBlockHtmlOptions } from './code-block';
export { tokenValueHtml, type TokenValueHtmlOptions } from './token-value';
export { checklistHtml, checklistRowHtml, type ChecklistHtmlOptions, type ChecklistRowHtmlOptions } from './checklist';
export { copyText } from '../utils/copy';
export type { BadgeTone, BadgeAppearance, BadgeSize } from '../components/Badge';
export type { ChecklistStatus } from '../components/Checklist';
export type { TokenValueSize } from '../components/TokenValue';
export type { TooltipSide } from '../components/Tooltip';
