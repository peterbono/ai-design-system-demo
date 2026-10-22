// Library > Use > Changelog, for any design system: one release per card, newest first. What is coming in the next
// release (pending entries), then each published release with its date and package versions. Each row: kind badge,
// the title at full width, one line on what it means, a small meta line (bump, packages); the rest of a long release
// and the internal changes fold. An announcement per release, ready to paste. Bridge's own page (pages/changelog.astro)
// renders it from its CHANGELOG.md files as a hydrated island; a team's Library from its snapshot's releases.
import { Badge, Button, EmptyState, Icon, Link, Tag } from '@bridge-ds/react';
import { Clock, Copy } from 'lucide-react';
import { shortPackage, type ChangelogEntry } from '@bridge-ds/core';
import { siteIcon } from '../../../../brand/site-icons';
import { mdTitleHtml } from '../../../../lib/markdown';
import { VOCAB } from '../../../../lib/vocabulary';
import { humanDate } from '../../../../lib/library/stats';
import { withAnnouncements } from '../../../../lib/library/use-pages';
import ReleaseEntries, { KINDS, type EntryRow } from '../../ReleaseEntries';
import VersionMenu from '../../VersionMenu';
import { LibraryHeader } from '../FoundationParts';
import { studioLink, type LibraryData } from '../library-data';

export const CHANGELOG_PAGE = { title: 'Changelog', art: 'guide' } as const;

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const counts = (entries: { kind: string }[]) => KINDS.map((k) => ({ ...k, n: entries.filter((e) => e.kind === k.kind).length })).filter((k) => k.n > 0);

// One line under the title: the author's "For you" line, else the note's second sentence, else what a breaking change asks.
const row = (e: ChangelogEntry): EntryRow => {
  const authored = e.forYouAuthored ? e.forYou : '';
  const description = authored || e.detail || (e.kind === 'Breaking' ? e.forYou : '');
  return { kind: e.kind, titleHtml: mdTitleHtml(e.title), descriptionHtml: mdTitleHtml(description), bump: e.bump, packages: e.packages.map(shortPackage) };
};

/** What the view reads: no model, so Bridge's page can hydrate it with its releases alone. */
export type ChangelogData = Pick<LibraryData, 'team' | 'extras'>;

export default function ChangelogView({ data }: { data: ChangelogData }) {
  const all = withAnnouncements(data.extras.releases ?? []);
  const visibleKinds = KINDS.filter((k) => all.some((r) => r.entries.some((e) => e.kind === k.kind)));
  const latest = all.find((r) => !r.pending);
  const repoUrl = data.team ? `https://github.com/${encodeURIComponent(data.team.owner)}/${encodeURIComponent(data.team.repo)}` : data.extras.use?.bridge.repoUrl;
  const menu = data.extras.use?.versionMenu;
  return (
    <div>
      <LibraryHeader title={CHANGELOG_PAGE.title} art={CHANGELOG_PAGE.art} actions={menu ? <VersionMenu {...menu} /> : undefined}>
        What changed in each release of the design system and what it means for you, with an announcement ready to paste into Slack or an email. For the token-by-token history, open{' '}
        <Link href={studioLink(data, 'changes/?view=history')}>History in the Studio</Link>.
      </LibraryHeader>

      <ul className="kind-legend" aria-label="Labels used in this changelog">
        {(visibleKinds.length ? visibleKinds : KINDS).map((k) => (
          <li key={k.kind}>
            <Badge tone={k.tone} icon={k.icon}>
              {k.kind}
            </Badge>
            <span className="muted">{k.meaning}</span>
          </li>
        ))}
      </ul>

      {all.length === 0 ? (
        <EmptyState
          icon={Clock}
          title="No changes recorded yet"
          headingLevel={2}
          description={data.team && !data.extras.releases ? 'This Library has no release notes yet. Publish a new snapshot (bridge snapshot) and they show here.' : 'The first change shows up here once it is sent for review with a release note.'}
        />
      ) : (
        <ol className="timeline">
          {all.map((r) => (
            <li key={r.name} className="tl-item" data-pending={r.pending || undefined}>
              <span className="tl-node" aria-hidden="true" />
              <section className="release-card" aria-labelledby={`r-${slug(r.name)}`}>
                <header className="release-head">
                  <div className="release-title">
                    <h2 id={`r-${slug(r.name)}`}>{r.name}</h2>
                    <p className="release-meta">
                      {r.pending ? (
                        <Badge tone="warning">Not released yet</Badge>
                      ) : (
                        <>
                          <Badge tone="success">Released</Badge>
                          {r.date && (
                            <span className="muted small">
                              <time dateTime={r.date}>{humanDate(r.date)}</time>
                            </span>
                          )}
                        </>
                      )}
                    </p>
                    {!r.pending && r.packages.some((p) => p.published) && (
                      <p className="release-pkgs" aria-label="Packages published in this release">
                        {r.packages
                          .filter((p) => p.published)
                          .map((p, i) => (
                            <Tag key={`${p.name}-${i}`} size="sm">{`${shortPackage(p.name)} ${p.version}`}</Tag>
                          ))}
                      </p>
                    )}
                  </div>
                  <ul className="release-counts" aria-label="Changes by kind">
                    {counts(r.entries).map((k) => (
                      <li key={k.kind}>
                        <strong className="num">{k.n}</strong> <span className="muted">{k.kind}</span>
                      </li>
                    ))}
                  </ul>
                </header>

                <ReleaseEntries entries={r.entries.map(row)} visible={r.pending || r === latest ? 6 : 3} />

                <div className="announce">
                  <div className="announce-head">
                    <span className="announce-avatar" aria-hidden="true">
                      <Icon icon={siteIcon('agent')} size="md" className="icon" />
                    </span>
                    <div>
                      <h3 id={`a-${slug(r.name)}`}>Announcement</h3>
                      <p className="muted small">Ready to paste into Slack, Teams or an email.</p>
                    </div>
                    <Button variant="secondary" size="sm" iconStart={Copy} className="announce-copy" data-copy="" data-copy-from={`s-${slug(r.name)}`} aria-describedby={`a-${slug(r.name)}`}>
                      <span data-copy-label="">Copy for Slack or email</span>
                    </Button>
                  </div>
                  <pre className="announce-body" id={`s-${slug(r.name)}`}>
                    {r.announcement}
                  </pre>
                </div>
              </section>
            </li>
          ))}
        </ol>
      )}

      {repoUrl && (
        <p className="cl-gh muted small">
          Every release, with its package versions, is also on GitHub.{' '}
          <Link href={`${repoUrl}/releases`} external>
            {VOCAB.openOnGitHub}
          </Link>
        </p>
      )}
    </div>
  );
}
