// "In Figma: Button" on a component's Library page, under the hero, and in the Studio Components drawer, when the
// component map (bridge.components.json, core component-map.ts) links it: everyone reads it and opens the component in
// the team's Figma file. When it is not linked, only the people who can fix it (a lead or an admin) read "Not linked to
// Figma yet." with the next step: ask Claude to link it, or add the team's Figma file in Settings first. Everyone else
// sees nothing. Every caller passes what the model says (figmaLinkFor) and who reads it (`canFix`): a team's Library and
// Studio from the team's read (scripts/team-data teamLead), Bridge's own Library from the maintainer check
// (FigmaLinkSite), since it never starts the Studio's GitHub session. Pure: props only.
import { Icon, Link } from '@bridge-ds/react';
import { FigmaMark } from '../studio/brand-icons';
import { figmaFileOf, figmaLinkOf, type RepoModel } from '@bridge-ds/core';
import { FIGMA_FILE_WORDS } from '../../../lib/figma-file';
import '../../../styles/figma-link.css';

export interface FigmaLinkProps {
  /** The component's Figma component, null when the map does not link it. */
  link: { name: string; url: string } | null;
  /** The team has set its Figma file (Settings > Figma file). */
  fileSet: boolean;
  /** Settings > Figma file, for this Library's team. */
  settingsHref: string;
  /** A lead or an admin of the team reads the page: they alone read the "not linked" line and its next step. */
  canFix: boolean;
}

/** What the model says about one component: its Figma link and whether the team set its Figma file. */
export function figmaLinkFor(model: Pick<RepoModel, 'componentMap' | 'config'>, name: string): Pick<FigmaLinkProps, 'link' | 'fileSet'> {
  const link = figmaLinkOf(model.componentMap ?? null, name);
  return { link: link ? { name: link.name, url: link.url } : null, fileSet: Boolean(figmaFileOf(model.config)) };
}

export function FigmaLink({ link, fileSet, settingsHref, canFix }: FigmaLinkProps) {
  if (link) {
    return (
      <p className="t-ui cp-figma">
        <Icon icon={FigmaMark} size="sm" />
        <span>{FIGMA_FILE_WORDS.inFigma}</span>
        <Link href={link.url} external>
          {link.name}
        </Link>
      </p>
    );
  }
  if (!canFix) return null;
  return (
    <p className="t-ui cp-figma cp-figma-missing">
      <Icon icon={FigmaMark} size="sm" />
      <span>{FIGMA_FILE_WORDS.notLinked}</span>
      {fileSet ? <span className="cp-figma-how">{FIGMA_FILE_WORDS.howToLink}</span> : <Link href={settingsHref}>{FIGMA_FILE_WORDS.setFileFirst}</Link>}
    </p>
  );
}
