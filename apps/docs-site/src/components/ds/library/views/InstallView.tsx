// Library > Use > Install, for any design system: its packages from npm, its themes, brands and densities, the bridge
// CLI and the DS Bridge Figma plugin. Bridge's own page (pages/install.astro) renders it at build time with its code
// samples; a team's Library in the browser, with the packages its snapshot lists (LibraryTeamUse.tsx).
import { CodeBlock, Link } from '@bridge-ds/react';
import { npmUrl } from '../../../../lib/npm';
import { tokenAxes } from '../../../../lib/library/tokens';
import { installPackages } from '../../../../lib/library/use-pages';
import { LibraryHeader } from '../FoundationParts';
import { pageHref, systemName, type LibraryData } from '../library-data';

export const INSTALL_PAGE = { title: 'Install', art: 'guide' } as const;

export default function InstallView({ data }: { data: LibraryData }) {
  const use = data.extras.use;
  const bridge = use?.bridge;
  const own = !data.team;
  const name = systemName(data);
  const packages = use?.packages ?? [];
  const toInstall = installPackages(packages);
  const ui = toInstall.find((p) => !/tokens$/.test(p.name));
  const { modes, brands, densities } = tokenAxes(data.model);
  const cli = bridge ? [`npx ${bridge.cliPackage} check`, `npx ${bridge.cliPackage} tokens "danger text"`, `npx ${bridge.cliPackage} help`].join('\n') : '';
  const plugin = ['npm install', 'npm run plugin:build'].join('\n');
  const repo = data.team ? `${data.team.owner}/${data.team.repo}` : null;
  return (
    <div>
      <LibraryHeader title={INSTALL_PAGE.title} art={INSTALL_PAGE.art}>
        {own ? (
          <>
            Two ways to use the system: the packages from npm in a product codebase, and the DS Bridge plugin in Figma. Both read the same token files, so code and Figma never drift. For AI agents, see{' '}
            <Link href={pageHref(data, 'agents/')}>Agents</Link>.
          </>
        ) : (
          <>
            Two ways to use {name}: its packages from npm in a product codebase, and the DS Bridge plugin in Figma. Both read the same token files, so code and Figma never drift. For AI agents, see{' '}
            <Link href={pageHref(data, 'agents/')}>Agents</Link>.
          </>
        )}
      </LibraryHeader>

      <h2 id="npm">Install from npm</h2>
      {toInstall.length ? (
        <>
          <p>
            Add the components and the tokens to your product.{own && ui && <> <code>{ui.name}</code> needs React 18 or later.</>}
          </p>
          <CodeBlock className="cx-block" code={`npm install ${toInstall.map((p) => p.name).join(' ')}`} label="Install the packages" />
        </>
      ) : (
        <p className="muted">
          This Library does not list its packages yet. Publish a new snapshot (<code>bridge snapshot</code>) and they show here.
        </p>
      )}

      {use?.samples && (
        <>
          <h2 id="use">Use the components</h2>
          <p>
            Import the fonts, the tokens and the base styles once, then wrap the app in <code>ThemeProvider</code>:
          </p>
          <CodeBlock className="cx-block" code={use.samples.app} label="App.tsx" />
        </>
      )}

      <h2 id="theming">Theme, brand and density</h2>
      {use?.samples ? (
        <>
          <p>
            <code>ThemeProvider</code> sets <code>data-theme</code>, <code>data-brand</code> and <code>data-density</code> together and passes them to portaled overlays. Without React, or for
            plain CSS, set the three attributes yourself and read the tokens as CSS variables:
          </p>
          <CodeBlock className="cx-block" code={use.samples.html} label="Scope attributes" />
        </>
      ) : (
        <p>The tokens change with these modes. Every component page lets you switch brand and density in its preview toolbar.</p>
      )}
      <p className="small muted">
        Themes: {modes.join(', ')}. Brands: {brands.join(', ')}. Densities: {densities.join(', ')}.{use?.samples && ' Every component page lets you switch brand and density in its preview toolbar.'}
      </p>

      {use?.samples && (
        <>
          <h3 id="without-react">Pages without React</h3>
          <p>
            Static sites and pages built in plain scripts use <code>@bridge-ds/react/dom</code>. Each renderer is named after its component, <code>badgeHtml</code>, <code>codeBlockHtml</code>,{' '}
            <code>tokenValueHtml</code>, <code>checklistHtml</code>, and returns the exact markup of the React component with the same classes. Call <code>bindTooltips()</code> and{' '}
            <code>bindCodeBlocks()</code> once per page so tooltips and copy buttons work.
          </p>
          <CodeBlock className="cx-block" code={use.samples.dom} label="Render without React" />
          <p className="small muted">
            <code>bridge audit</code> counts this markup as DS components. Homemade look-alikes, such as pill classes or <code>data-tip</code> tooltips, count against adoption.
          </p>
        </>
      )}

      {bridge && (
        <>
          <h2 id="cli">Check tokens from a terminal</h2>
          <p>
            In {own ? 'your design system repository' : `a clone of ${repo}`}, the <code>bridge</code> command validates tokens and runs the contrast gate, with nothing to install first. Use it
            in CI: exit 0 ok, 1 failures, 2 setup error. To connect Claude, see <Link href={pageHref(data, 'agents/#mcp')}>Agents</Link>.
          </p>
          <CodeBlock className="cx-block" code={cli} label="bridge CLI commands" />
        </>
      )}

      {packages.length > 0 && (
        <>
          <h2 id="packages">Packages</h2>
          <ul className="pkg-list">
            {packages.map((p) => (
              <li key={p.name}>
                <Link href={npmUrl(p.name)}>
                  <code>{p.name}</code>
                </Link>{' '}
                <span className="muted small num">{p.version}</span>
                {p.use && <p>{p.use}</p>}
              </li>
            ))}
          </ul>
        </>
      )}

      {bridge && (
        <>
          <h2 id="figma-plugin">Figma plugin</h2>
          <p>
            DS Bridge connects Figma Variables to the repository. <strong>Pull</strong> brings the latest tokens from the library into Figma Variables. <strong>Push</strong> sends your Figma edits
            back as a pull request for review, with a three-way diff and the contrast gate. It works on the free Figma plan and never writes to the library directly.
          </p>
          <ol className="lib-steps">
            <li>
              <p>{own ? 'From the repository root, build the plugin:' : <>From a clone of <Link href={bridge.repoUrl}>Bridge</Link>, build the plugin:</>}</p>
              <CodeBlock className="cx-block" code={plugin} label="Build the plugin" />
            </li>
            <li>
              <p>
                In the Figma desktop app: Plugins, Development, Import plugin from manifest, and pick <code>apps/figma-plugin/manifest.json</code>.
              </p>
            </li>
            <li>
              <p>
                Run it from Plugins, Development, DS Bridge, and paste a fine-grained GitHub token in its Settings tab{repo && <>, then connect <code>{repo}</code></>}.
              </p>
            </li>
          </ol>
          <p className="small muted">
            Not in Figma Community yet: publishing needs a plugin id issued by Figma. Full guide in <Link href={bridge.pluginUrl}>apps/figma-plugin</Link>, source on{' '}
            <Link href={bridge.repoUrl}>GitHub</Link>, details in <Link href={bridge.pluginReadmeUrl}>the plugin README</Link>.
          </p>
        </>
      )}

      {use?.samples && (
        <details className="cx-details" id="from-a-clone">
          <summary>For contributors: install from a clone</summary>
          <p>
            To try changes that are not released yet, build the packages and pack them as tarballs in <code>.packs/</code>:
          </p>
          <CodeBlock className="cx-block" code={use.samples.clone} label="Build and pack commands" />
          <p>Then, in your product, install the tarballs:</p>
          <CodeBlock className="cx-block" code={use.samples.add} label="Install the tarballs" />
        </details>
      )}
    </div>
  );
}
