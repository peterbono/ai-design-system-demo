// Edit mode on a team's Library component page: the same editor as this site's own component pages
// (components/LibraryEditMode.tsx, ?edit=1), writing to the team's repository. Mounted by LibraryTeamComponents.tsx for
// a reader who can write (a member, signed in with the team's session). It points the page at the team first
// (scripts/repo-context.ts setLibraryTeam), so the editor's reads and sends go through the member's session (an email
// member through Bridge, a GitHub member with their token), with the team's settings (direct or suggest mode); its
// drafting context comes from the team's own code (lib/team-docs-ai.ts) and its links from the team's Studio.
import { useEffect, useState } from 'react';
import LibraryEditMode from '../../LibraryEditMode';
import type { ComponentInfo } from '../../../lib/library/components';
import { teamConventionPaths, teamDocsAiContext, teamEditProps } from '../../../lib/team-docs-ai';
import { setLibraryTeam } from '../../../scripts/repo-context';
import type { TeamData } from '../../../scripts/team-data';

export default function TeamEditMode({ data, component: c }: { data: TeamData; component: ComponentInfo }) {
  // undefined while the docs.json is read; null when the component has none.
  const [original, setOriginal] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    setLibraryTeam({ owner: data.owner, repo: data.repo });
    const read = (path: string, ref: string) => data.client.readFile(path, ref).catch(() => undefined);
    void import('../../../scripts/docs-ai').then(({ setDocsContextSource }) =>
      setDocsContextSource(async (slug) => {
        if (slug.toLowerCase() !== c.slug.toLowerCase()) throw new Error(`The drafting context of ${slug} is not on this page. Reload the page.`);
        const paths = teamConventionPaths(data.model, c);
        const [agents, designLanguage, example, source, styles] = await Promise.all([
          read(paths.agents, data.sha),
          read(paths.designLanguage, data.sha),
          paths.example ? read(paths.example, data.sha) : Promise.resolve(undefined),
          read(paths.source, data.sha),
          read(paths.styles, data.sha),
        ]);
        return teamDocsAiContext(data.model, c, { agents, designLanguage, example, source, styles });
      }),
    );
    void (c.docs ? read(c.files.docs, data.sha) : Promise.resolve(undefined)).then((text) => live && setOriginal(text ?? null));
    return () => {
      live = false;
      setLibraryTeam(null);
      void import('../../../scripts/docs-ai').then(({ setDocsContextSource }) => setDocsContextSource(null));
    };
    // One component per page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (original === undefined) return null;
  const { studio, ...props } = teamEditProps(data, c, original);
  return <LibraryEditMode {...props} team={{ studio, readFile: (path, ref) => data.client.readFile(path, ref) }} />;
}
