---
"@bridge/core": minor
"@bridge/cli": minor
"@bridge/mcp": minor
"@bridge/stylelint-plugin": minor
"@bridge/eslint-plugin": minor
---

Measure design system adoption in product code. `@bridge/core/audit` finds hardcoded colors, lengths, radii, shadows, durations, z-index and fonts in CSS, SCSS, style/sx/styled/theme objects, CSS-in-JS and Tailwind classes, suggests the closest token (deltaE in OKLab across every mode, nearest scale step), and counts DS components against foreign UI libraries, native elements and re-created components. `bridge audit <path>` reports token and component adoption as JSON (versioned schema) and Markdown, compares with a baseline, fails CI under a threshold, and `--fix --write` replaces exact CSS matches with `var(--token)`. The MCP server adds `bridge_audit` and the `migrate-file-to-ds` prompt. New `@bridge/stylelint-plugin` (`bridge/use-tokens`) and `@bridge/eslint-plugin` (`no-hardcoded-style-values`, `prefer-ds-components`).
