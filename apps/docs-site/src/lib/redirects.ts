// Old URLs keep working. Read by astro.config.mjs (Astro `redirects`) and by the build hook that carries the query
// string and hash over (deep links like /reviews/?pr=12 or /foundations/lookup/?q=%23ffffff).
// No dependencies: this file is loaded while Astro reads its config.
export const REDIRECTS: Record<string, string> = {
  '/foundations/contrast': '/foundations/accessibility/',
  '/foundations/lookup': '/tokens/',
  '/for-ai-agents': '/agents/',
  '/connect/mcp': '/agents/',
  '/reviews': '/studio/reviews/',
  '/history': '/studio/versions/',
  '/branches': '/studio/branches/',
  '/adoption': '/studio/adoption/',
  '/governance': '/studio/settings/governance/',
  // The theme playground left with the Field Guide redesign: brand and density now switch inside each preview.
  '/playground': '/',
};
