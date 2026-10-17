// Old URLs keep working. Read by astro.config.mjs (Astro `redirects`) and by the build hook that carries the query
// string and hash over (deep links like /reviews/?pr=12 or /foundations/lookup/?q=%23ffffff).
// No dependencies: this file is loaded while Astro reads its config.
export const REDIRECTS: Record<string, string> = {
  '/foundations/contrast': '/foundations/accessibility/',
  '/foundations/lookup': '/tokens/',
  '/for-ai-agents': '/agents/',
  '/connect/mcp': '/agents/',
  '/reviews': '/studio/changes/',
  '/history': '/studio/changes/?view=history',
  '/branches': '/studio/changes/#other-branches',
  // Drafts, Branches, Reviews, Versions and Visual impact became one Changes page (In review, History).
  '/studio/drafts': '/studio/changes/',
  '/studio/reviews': '/studio/changes/',
  '/studio/branches': '/studio/changes/#other-branches',
  '/studio/visual-impact': '/studio/changes/',
  '/studio/versions': '/studio/changes/?view=history',
  '/adoption': '/studio/quality/',
  // Checks and Adoption became one Quality page; each audit report has its own route under it.
  '/studio/checks': '/studio/quality/',
  '/studio/adoption': '/studio/quality/',
  // Settings became one page (Connection, Repository, Approvals); the governance prose moved to the Library.
  '/governance': '/how-review-works/',
  '/studio/settings/repository': '/studio/settings/#repository',
  '/studio/settings/governance': '/studio/settings/#approvals',
  '/studio/settings/integrations': '/studio/settings/#connection',
  // The theme playground left with the Field Guide redesign: brand and density now switch inside each preview.
  '/playground': '/',
};

/**
 * Where a redirect lands with the old URL's query and hash carried over: the old query wins key by key over the
 * target's own (/studio/reviews/?pr=3 -> /studio/changes/?pr=3), the old hash wins over the target's.
 */
export function redirectTarget(to: string, search: string, hash: string): string {
  const [pathAndQuery, toHash = ''] = to.split('#');
  const [path, toQuery = ''] = pathAndQuery!.split('?');
  const q = new URLSearchParams(toQuery);
  new URLSearchParams(search).forEach((v, k) => q.set(k, v));
  const qs = q.toString();
  const h = hash && hash !== '#' ? hash.replace(/^#/, '') : toHash;
  return `${path}${qs ? `?${qs}` : ''}${h ? `#${h}` : ''}`;
}

/** The one-line script of a redirect page: same rules as redirectTarget, inlined (no module on that page). */
export function redirectScript(to: string): string {
  return `<script>(function(t,s,h){var a=t.split('#'),b=a[0].split('?'),q=new URLSearchParams(b[1]||'');new URLSearchParams(s).forEach(function(v,k){q.set(k,v)});var x=q.toString(),y=h&&h!=='#'?h.slice(1):(a[1]||'');location.replace(b[0]+(x?'?'+x:'')+(y?'#'+y:''))})(${JSON.stringify(to)},location.search,location.hash)</script>`;
}
