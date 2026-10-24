// Studio "Being built" (pages/studio/building.astro and its team shell): the build requests sent from Figma and where
// each one stands, read from GitHub only (scripts/building-data.ts, rules in lib/building-view.ts and @bridge-ds/core).
//   - One sentence first (the Harbor zone), then the filters (All, Waiting to be picked up, In progress, Shipped this
//     week) and one row per build request: the shared BranchRow, who builds it, when it was sent, one status tag.
//     The whole row opens the detail in place (?request=N, ?pull=N); no row buttons.
//   - The detail: what was sent (summary, before and after, props needed, the Figma link), the status line, and a
//     "For developers" fold with the GitHub and Jira links and "Copy brief for Claude".
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
  SegmentedControl,
  Skeleton,
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
  buildDetail,
  detailFromQuery,
  detailQuery,
  filterCounts,
  jiraLink,
  pageSentence,
  propLine,
  rowLine,
  shortDate,
  statusTag,
  timelineSteps,
  viewTitle,
} from "../../../lib/building-view";
import { loadBuildData, type BuildData } from "../../../scripts/building-data";

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
  views: BuildRequestView[];
  data: BuildData;
  now: number;
  onOpen: (v: BuildRequestView) => void;
}) {
  return (
    <ul className="sh-rows bb-rows" aria-label="Build requests">
      {views.map((v) => {
        const href = detailQuery(v);
        const click = (e: MouseEvent<HTMLAnchorElement>) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
          e.preventDefault();
          onOpen(v);
        };
        return (
          <BranchRow
            key={v.id}
            thumb={{ kind: "icon", icon: "component" }}
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
                    {[
                      ...d.before.map((u) => ({ u, k: BUILD_IMAGE_LABEL.before })),
                      ...d.after.map((u) => ({ u, k: BUILD_IMAGE_LABEL.after })),
                    ].flatMap(({ u, k }, i) => {
                      const src = safeUrl(u);
                      return src
                        ? [
                            <figure key={`${k}-${i}`} className="bb-figure">
                              <img
                                src={src}
                                alt={`${v.component}, ${k.charAt(0).toLowerCase()}${k.slice(1)}`}
                                loading="lazy"
                              />
                              <figcaption className="t-ui t-muted">
                                {k}
                              </figcaption>
                            </figure>,
                          ]
                        : [];
                    })}
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
  if (!data.views.length) return <Empty />;

  const counts = filterCounts(data.views, now);
  const shown = data.views.filter((v) => matchesBuildFilter(v, filter, now));
  return (
    <div className="bb">
      <section className="zone bb-open" aria-live="polite">
        <p className="t-body bb-sentence">{pageSentence(data.views)}</p>
        <p className="t-ui t-muted bb-rule">
          Changes from Figma or from Components that need code. Developers pick them up in GitHub
          or Jira; each one reads Shipped once it is in the library.
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
        <SegmentedControl
          label="Show"
          size="md"
          value={filter}
          onValueChange={(f) => setFilter(f as BuildFilter)}
          items={BUILD_FILTERS.map((f) => ({
            value: f.value,
            label: counts[f.value] ? `${f.label} ${counts[f.value]}` : f.label,
          }))}
        />
      </div>
      {shown.length ? (
        <Rows views={shown} data={data} now={now} onOpen={go} />
      ) : (
        <p className="t-body t-muted bb-none">{EMPTY_FILTER[filter]}</p>
      )}
    </div>
  );
}
