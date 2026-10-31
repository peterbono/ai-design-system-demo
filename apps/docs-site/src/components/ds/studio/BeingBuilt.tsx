// Studio "Being built" (pages/studio/building.astro and its team shell): the build requests sent from Figma and where
// each one stands, read from GitHub only (scripts/building-data.ts, rules in lib/building-view.ts and @bridge-ds/core).
//   - One sentence first (the Harbor zone), then the filters (All, Waiting to be picked up, In progress, Shipped this
//     week) and one row per build request: the shared BranchRow, who builds it, when it was sent, one status tag.
//     The whole row opens the detail in place (?request=N, ?pull=N); no row buttons.
//   - The detail: what was sent (summary, before and after, props needed, the Figma link), the status line, and a
//     "For developers" fold with the GitHub and Jira links and "Copy brief for Claude".
//   - Claude's fixes (the fix sessions of the team's Claude) are rows of the same list, with the same tags and filters:
//     "Button" then "Claude's fix from Figma, asked by Dana" and where it stands, from its pull request when the list
//     read it (lib/claude-connector fixRows). Such a row opens Claude's fix in Studio; while Claude works, the page reads
//     the sessions again every 10 seconds (paused while the tab is hidden).
//   - Explorations handed to developers (Done exploring) are rows of the same list too, with an "Exploration" tag: the
//     product, who said Done exploring and when. Such a row opens the exploration in Studio.
//   - Nothing sent yet: what a build request is, where it comes from, who picks it up.
// Read only: developers split and track the work in GitHub or Jira. Repo content goes in as React text only, links
// through safeUrl.
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MouseEvent,
} from "react";
import {
  Accordion,
  AccordionItem,
  Alert,
  AvatarGroup,
  Badge,
  Button,
  Icon,
  Link,
  Skeleton,
  Tab,
  Tabs,
  TabsList,
} from "@bridge-ds/react";
import { Check, Hammer } from "lucide-react";
import {
  BUILD_IMAGE_LABEL,
  matchesBuildFilter,
  type BuildFilter,
  type BuildRequestView,
} from "@bridge-ds/core";
import { BranchRow } from "./BranchRow";
import { Drawing } from "./Drawing";
import { Who } from "./faces";
import { person } from "../../../lib/home-model";
import { safeUrl } from "../../../lib/html";
import {
  BUILD_FILTERS,
  EMPTY_FILTER,
  EMPTY_WORDS,
  EXPLORATION_KIND,
  buildDetail,
  detailFromQuery,
  detailQuery,
  filterCounts,
  jiraLink,
  listedRows,
  mergeRows,
  pageSentence,
  propLine,
  rowLine,
  rowThumb,
  shortDate,
  statusTag,
  timelineSteps,
  viewTitle,
  type ExplorationBuildRow,
} from "../../../lib/building-view";
import { FIX_ROW_TITLE, type FixRow } from "../../../lib/claude-connector";
import { studioHref } from "../../../lib/team-path";
import {
  loadBuildData,
  readFixes,
  type BuildData,
} from "../../../scripts/building-data";

const TONE = {
  warning: "warning",
  danger: "danger",
  success: "success",
  neutral: "neutral",
  info: "info",
} as const;
const avatar = (login: string) =>
  `https://github.com/${encodeURIComponent(login)}.png?size=64`;
const external = { target: "_blank", rel: "noopener noreferrer" } as const;
const POLL_MS = 10_000;
type Row = BuildRequestView | FixRow | ExplorationBuildRow;
const isFix = (v: Row): v is FixRow => "fix" in v;
const isExploration = (v: Row): v is ExplorationBuildRow => "exploration" in v;

function Builders({
  v,
  data,
  size = "md",
}: {
  v: BuildRequestView;
  data: BuildData;
  size?: "sm" | "md";
}) {
  if (!v.builders.length)
    return (
      <span className="bb-nobody" aria-hidden="true">
        <Icon icon={Hammer} size="sm" />
      </span>
    );
  // The sample team draws each builder's face from their sample login (~malik-haddad), the same face as in Members.
  const people = v.builders.map((l) =>
    data.sample
      ? person(`~${l}`, data.nameOf(l), null)
      : person(l, data.nameOf(l), avatar(l))
  );
  if (people.length === 1) return <Who p={people[0]!} size={size} />;
  return (
    <AvatarGroup aria-label="Building it" max={2} size={size}>
      {people.map((p) => (
        <Who key={p.login} p={p} size={size} />
      ))}
    </AvatarGroup>
  );
}

function Rows({
  views,
  data,
  now,
  onOpen,
}: {
  views: Row[];
  data: BuildData;
  now: number;
  onOpen: (v: BuildRequestView) => void;
}) {
  return (
    <ul className="sh-rows bb-rows" aria-label="Build requests">
      {views.map((v) => {
        // Claude's fix: the row opens it in Studio (its review), like the home opens a branch.
        if (isFix(v))
          return (
            <BranchRow
              key={v.id}
              thumb={{ kind: "icon", icon: "component", label: v.component }}
              who={<Builders v={v} data={data} />}
              title={v.component}
              hint={`${v.component}: ${FIX_ROW_TITLE}`}
              href={studioHref(v.fix.href)}
              line={v.fix.line}
              pill={statusTag(v)}
              className={v.stale ? "bb-stale" : undefined}
            />
          );
        // An exploration handed to developers: the row opens the exploration, its kind tagged.
        if (isExploration(v))
          return (
            <BranchRow
              key={v.id}
              thumb={{ kind: "screen", src: null, product: v.exploration.product, seed: v.id }}
              who={<Builders v={v} data={data} />}
              title={v.title}
              hint={`${EXPLORATION_KIND}: ${v.title}`}
              href={studioHref(v.exploration.href)}
              line={v.exploration.line}
              tags={
                <Badge tone="neutral" size="sm">
                  {EXPLORATION_KIND}
                </Badge>
              }
              pill={statusTag(v)}
              className={v.stale ? "bb-stale" : undefined}
            />
          );
        const href = detailQuery(v);
        const click = (e: MouseEvent<HTMLAnchorElement>) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
          e.preventDefault();
          onOpen(v);
        };
        return (
          <BranchRow
            key={v.id}
            thumb={rowThumb(v, data.bodies.get(v.number))}
            who={<Builders v={v} data={data} />}
            title={viewTitle(v)}
            href={href}
            onClick={click}
            line={rowLine(v, now, data.nameOf)}
            pill={statusTag(v)}
            className={v.stale ? "bb-stale" : undefined}
          />
        );
      })}
    </ul>
  );
}

function Empty() {
  return (
    <div className="bb-empty">
      <Drawing name="fix" width={160} />
      <h2 className="bb-empty-title">{EMPTY_WORDS.title}</h2>
      <p className="t-body bb-measure">{EMPTY_WORDS.text}</p>
      <p className="t-ui t-muted bb-measure">{EMPTY_WORDS.more}</p>
    </div>
  );
}

function CopyBrief({ brief }: { brief: string }) {
  const [done, setDone] = useState<"copied" | "failed" | null>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(brief);
      setDone("copied");
    } catch {
      setDone("failed");
    }
  };
  return (
    <span className="bb-copy">
      <Button variant="secondary" onClick={() => void copy()}>
        Copy brief for Claude
      </Button>
      <span className="t-ui t-muted" role="status">
        {done === "copied"
          ? "Copied. Paste it in Claude Code."
          : done === "failed"
          ? "Your browser blocked copying. Open the issue on GitHub: the brief is there."
          : ""}
      </span>
    </span>
  );
}

function Detail({
  v,
  data,
  onBack,
}: {
  v: BuildRequestView;
  data: BuildData;
  onBack: () => void;
}) {
  const d = useMemo(
    () =>
      v.kind === "issue" ? buildDetail(data.bodies.get(v.number), v) : null,
    [v, data]
  );
  const steps = timelineSteps(v);
  const tag = statusTag(v);
  const jira = jiraLink(v.jira, data.jiraBase);
  const figma = safeUrl(d?.figmaUrl ?? v.figmaUrl);
  const who = (l?: string) => (l ? data.nameOf(l) : null);
  const back = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    onBack();
  };
  return (
    <article className="bb-detail" aria-labelledby="bb-detail-title">
      <Link href="?" variant="standalone" onClick={back} className="bb-back">
        All build requests
      </Link>
      <header className="bb-head">
        <h2 className="bb-title" id="bb-detail-title">
          {viewTitle(v)}
        </h2>
        <p className="t-body bb-sub">
          <Badge tone={TONE[tag.tone]} size="md">
            {tag.label}
          </Badge>{" "}
          {v.sentence}
        </p>
      </header>

      <div className="bb-body">
        <div className="bb-main">
          <section className="bb-section" aria-labelledby="bb-sent">
            <h3 className="t-ui bb-h" id="bb-sent">
              What was sent
            </h3>
            {d ? (
              <>
                <p className="t-body bb-measure">{d.summary}</p>
                {d.line && <p className="t-body bb-measure">{d.line}</p>}
                {(d.before.length > 0 || d.after.length > 0) && (
                  <div className="bb-images">
                    {(
                      [
                        [BUILD_IMAGE_LABEL.before, d.before],
                        [BUILD_IMAGE_LABEL.after, d.after],
                      ] as const
                    ).flatMap(([k, urls]) =>
                      urls.flatMap((u, i) => {
                        const src = safeUrl(u);
                        const alt = `${v.component}, ${k.charAt(0).toLowerCase()}${k.slice(1)}`;
                        return src
                          ? [
                              <figure key={`${k}-${i}`} className="bb-figure">
                                <figcaption className="t-ui t-muted">
                                  {k}
                                </figcaption>
                                <Link
                                  href={src}
                                  {...external}
                                  className="bb-frame"
                                  aria-label={`${alt}, open full size`}
                                >
                                  <img src={src} alt={alt} loading="lazy" />
                                </Link>
                              </figure>,
                            ]
                          : [];
                      })
                    )}
                  </div>
                )}
                {d.props.length > 0 && (
                  <>
                    <h4 className="t-ui bb-h4">Options it needs</h4>
                    <ul className="t-body bb-list">
                      {d.props.map((p) => (
                        <li key={p.name}>{propLine(p)}</li>
                      ))}
                    </ul>
                  </>
                )}
                {d.props.length === 0 && d.changes.length > 0 && (
                  <ul className="t-body bb-list">
                    {d.changes.map((c) => (
                      <li key={c.field}>
                        {c.field}: {c.before ? `${c.before} becomes ` : ""}
                        {c.after ?? "removed"}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <p className="t-body bb-measure">
                It was sent from the Figma plugin as a library change. The
                design and what changed are on the change.
              </p>
            )}
            <p className="t-ui t-muted bb-meta">
              {v.requestedBy
                ? `Sent by ${data.nameOf(v.requestedBy)} on ${shortDate(
                    v.createdAt
                  )}.`
                : `Sent on ${shortDate(v.createdAt)}.`}{" "}
              {figma && (
                <Link href={figma} {...external}>
                  Open in Figma
                </Link>
              )}
            </p>
          </section>

          <Accordion className="bb-dev" headingLevel={3}>
            <AccordionItem value="dev" title="For developers">
              {data.sample && (
                <p className="t-ui t-muted bb-measure">
                  On a real team, these open the build request and its pull
                  request on GitHub, and the ticket in Jira.
                </p>
              )}
              <ul className="t-ui bb-links" hidden={data.sample}>
                <li>
                  <Link href={safeUrl(v.url, "#")} {...external}>
                    {v.kind === "issue"
                      ? `Build request #${v.number} on GitHub`
                      : `Change #${v.number} on GitHub`}
                  </Link>
                </li>
                {v.pull && v.pull.number !== v.number && (
                  <li>
                    <Link href={safeUrl(v.pull.url, "#")} {...external}>
                      Pull request #{v.pull.number} on GitHub
                    </Link>
                  </li>
                )}
                {v.jira && (
                  <li>
                    {jira ? (
                      <Link href={jira} {...external}>
                        {v.jira} in Jira
                      </Link>
                    ) : (
                      <span>Jira: {v.jira}</span>
                    )}
                  </li>
                )}
              </ul>
              {d?.brief ? (
                <>
                  <p className="t-ui t-muted bb-measure">
                    The brief gives Claude Code the change, the props, the Figma
                    link and how to close this request when it ships.
                    {d.hasSpec ? " The full spec is in the issue." : ""}
                  </p>
                  <CopyBrief brief={d.brief} />
                </>
              ) : (
                <p className="t-ui t-muted bb-measure">
                  The brief for Claude is on the branch: bridge figma show{" "}
                  {v.number}.
                </p>
              )}
            </AccordionItem>
          </Accordion>
        </div>
        <aside className="bb-aside">
          <section className="bb-section bb-status" aria-labelledby="bb-status">
            <h3 className="t-ui bb-h" id="bb-status">
              Where it stands
            </h3>
            <ol className="bb-steps">
              {steps.map((s) => (
                <li
                  key={s.status}
                  className={`bb-step${s.reached ? " is-reached" : ""}${
                    s.current ? " is-current" : ""
                  }`}
                  aria-current={s.current ? "step" : undefined}
                >
                  <span className="bb-dot" aria-hidden="true">
                    {s.reached && <Icon icon={Check} size="sm" />}
                  </span>
                  <span className="t-ui bb-step-text">
                    <span className="bb-step-label">{s.label}</span>
                    {(s.who || s.at) && (
                      <span className="t-muted">
                        {" "}
                        {[who(s.who), s.at ? shortDate(s.at) : null]
                          .filter(Boolean)
                          .join(", ")}
                      </span>
                    )}
                    {!s.reached && <span className="sr-only"> (not yet)</span>}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
    </article>
  );
}

export default function BeingBuilt() {
  const [data, setData] = useState<BuildData | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<BuildFilter>("all");
  const [open, setOpen] = useState<{
    kind: "issue" | "pull";
    number: number;
  } | null>(() =>
    typeof location === "undefined" ? null : detailFromQuery(location.search)
  );
  const now = useMemo(() => Date.now(), [data]);

  // While Claude works on a fix, its row follows each step: the sessions are read again (never GitHub).
  const working = Boolean(data?.fixes?.some((f) => f.fix.working));
  useEffect(() => {
    if (!data || !working) return;
    let live = true;
    const timer = setTimeout(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        setData({ ...data });
        return;
      }
      readFixes(data)
        .then((fixes) => live && setData({ ...data, fixes }))
        .catch(() => {});
    }, POLL_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [data, working]);

  useEffect(() => {
    let live = true;
    loadBuildData()
      .then((d) => live && setData(d))
      .catch(() => live && setFailed(true));
    const pop = () => setOpen(detailFromQuery(location.search));
    window.addEventListener("popstate", pop);
    return () => {
      live = false;
      window.removeEventListener("popstate", pop);
    };
  }, []);

  const go = useCallback((v: BuildRequestView | null) => {
    const url = v ? detailQuery(v) : location.pathname;
    history.pushState(null, "", url);
    setOpen(v ? { kind: v.kind, number: v.number } : null);
    window.scrollTo({ top: 0 });
  }, []);

  if (failed)
    return (
      <Alert tone="warning" title="Build requests could not be read right now.">
        Reload the page in a minute. They are also on GitHub, labelled
        component-change.
      </Alert>
    );
  if (!data)
    return (
      <div className="bb" aria-busy="true" aria-label="Reading build requests">
        <Skeleton variant="rect" className="bb-skel" />
        <Skeleton variant="rect" className="bb-skel" />
      </div>
    );

  const current = open
    ? data.views.find((v) => v.kind === open.kind && v.number === open.number)
    : null;
  if (current)
    return <Detail v={current} data={data} onBack={() => go(null)} />;
  // Only what "All" lists counts: a request declined more than a week ago has left the page (sentence, counts, empty).
  const rows = listedRows(
    mergeRows<FixRow | ExplorationBuildRow>(data.views, [
      ...(data.fixes ?? []),
      ...(data.explorations ?? []),
    ]),
    now
  );
  if (!rows.length) return <Empty />;

  const counts = filterCounts(rows, now);
  const shown = rows.filter((v) => matchesBuildFilter(v, filter, now));
  return (
    <div className="bb">
      <section className="zone bb-open" aria-live="polite">
        <p className="t-body bb-sentence">{pageSentence(rows)}</p>
        <p className="t-ui t-muted bb-rule">
          Explorations handed to developers and changes from Figma or Components that need code.
          Developers pick them up in GitHub or Jira; each one reads Shipped once it is in the library.
          {data.fixes?.length
            ? " Claude's fixes from Figma are here too: someone on your team reviews each one."
            : ""}
        </p>
        {data.sample && (
          <p className="t-ui t-muted">
            Sample build requests of the sample team. Nothing here is sent.
          </p>
        )}
        {data.stale && (
          <p className="t-ui t-muted">
            Shown as last read: GitHub is busy, it refreshes on its own.
          </p>
        )}
      </section>
      <div className="bb-bar">
        <Tabs value={filter} onValueChange={(f) => f !== null && setFilter(f as BuildFilter)}>
          <TabsList aria-label="Show">
            {BUILD_FILTERS.map((f) => (
              <Tab key={f.value} value={f.value} count={counts[f.value] ?? 0}>
                {f.label}
              </Tab>
            ))}
          </TabsList>
        </Tabs>
      </div>
      {shown.length ? (
        <Rows views={shown} data={data} now={now} onOpen={go} />
      ) : (
        <p className="t-body t-muted bb-none">{EMPTY_FILTER[filter]}</p>
      )}
    </div>
  );
}
