// Component data of this build, for the pages: thin wrappers over the pure lib/library/components.ts with the
// build-time repo model (lib/model.ts, @bridge-ds/core component-scan over bridge.config.json components.dir).
import { repoModel } from './model';
import * as lib from './library/components';
import type { ComponentInfo } from './library/components';

export type { ComponentDocs, ComponentInfo, Control, CssRule, ExampleNode, GuidanceItem, GuidanceState, PlaygroundSpec, Prop } from './library/components';
export { docsEditHref, editTokensHref, findNode, guidanceState, playgroundSpec, resolveInherited, tokenCountLabel } from './library/components';

/** Components folder, repo-relative (bridge.config.json components.dir). */
export const COMPONENTS_DIR = lib.componentsDir(repoModel);

/** Families in the order the barrel file (packages/react/src/index.ts) lists them ("// Actions" then its exports). */
export const families = (): { name: string; members: string[] }[] => lib.families(repoModel);

/** Every component, sorted by family then name. */
export const loadComponents = (): ComponentInfo[] => lib.loadComponents(repoModel);

/** Component slug -> name, token paths and inherited-from components, for the Studio Tokens ?component= filter. */
export const componentTokenIndex = () => lib.componentTokenIndex(repoModel);

/** Which components a CSS variable reaches, directly or through any alias chain in any brand, theme or density. */
export const componentsUsing = (cssVar: string) => lib.componentsUsing(repoModel, cssVar);
