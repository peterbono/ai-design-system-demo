// @bridge-ds/core/audit: design-system adoption and drift in a product codebase. Pure (no fs): callers pass file
// texts and a token set; `@bridge-ds/core/node` reads a folder from disk. Uses the TypeScript compiler API (syntax
// only) to read TSX/JSX, which is why it is a separate entry from the main one (the Figma plugin never loads it).
export * from './types';
export * from './color';
export * from './tailwind';
export * from './scan-value';
export * from './css';
export * from './components';
export * from './ds-index';
export * from './code';
export * from './report';
export * from './style';
export * from './ignore';
export * from './markup';
