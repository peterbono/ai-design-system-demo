# Component change requests

Designers ask, developers implement, code stays the source of truth. Pushed from the Figma plugin, a component change
that needs code is a **build request**: see [BUILD-REQUESTS.md](BUILD-REQUESTS.md).

## The rule

- **Variables are pull requests.** A token value change is data: Bridge opens a pull request that the design and
  tech owners approve (see [GOVERNANCE.md](GOVERNANCE.md)).
- **Components are requests.** A new component, a structure change, a new variant or prop, a visual change or a
  different token binding needs code. Bridge never rewrites React from Figma: it files a **request**, a GitHub
  issue labeled `component-change`, and a developer implements it (with their own Claude if they like) in a pull
  request that says `Closes #n`.
- **Jira is optional, and recommended.** Bridge has no backend. If your team plans in Jira, the
  `bridge-jira` GitHub Action mirrors each request to Jira from your own repo, with your own secrets. Nothing is
  required to use requests on GitHub alone.

## The flow

| Step | Where | What happens |
| --- | --- | --- |
| 1. Ask | Figma plugin, Bridge Studio, `bridge request create`, or Claude (`bridge_create_request`) | The request is written once, in one format: component, kind, title, summary, the changes asked (what, now, requested), the Figma link and images |
| 2. Issue | GitHub | An issue titled `Button: add a danger ghost variant`, labeled `component-change`, `request: <kind>` and `source: <where>`, plus your `integrations.requests` labels and assignees. The body is Markdown for people and one hidden JSON block for tools |
| 3. Jira (optional) | `bridge-jira` Action | A Jira issue in your project, linked back: comment `Jira: DS-12 <url>` and label `jira: DS-12` on the GitHub issue |
| 4. Implement | Your terminal, with Claude | `bridge request implement 42 --claude` (or the `bridge_get_request` MCP tool) gives Claude the request, the component files and the repo rules |
| 5. Pull request | GitHub | A branch `agent/request-42` and a pull request whose body says `Closes #42`. It goes through the usual review and CI |
| 6. Done | GitHub, then Jira | Merging closes the issue; the Action comments `Closed in GitHub (#42), completed` on the Jira issue |

**On an exploration.** A request can target an exploration branch instead (`--exploration explore/<name>` in the CLI,
`exploration` in `bridge_create_request`, or the exploration's page in Studio). The issue gets the `exploration`
label, and the brief says to commit on that branch and never open a pull request to `main`: the work ships to
product staging as a snapshot and reaches review only when the exploration is promoted, which closes the request.
See [EXPLORATIONS.md](EXPLORATIONS.md).

Status, everywhere (Studio, CLI, MCP): **requested** (open, no pull request), **in progress** (an open pull request
says `Closes #n`), **done** (closed as completed, or by a merged pull request), **declined** (closed otherwise).
Bridge reads `Closes`, `Fixes` and `Resolves` in pull request bodies, like GitHub does.

## Kinds

`new-component`, `new-variant`, `prop-change`, `structure`, `visual`, `token-binding`, `bug`, `other`. A new component, prop or
variant is Tier 2 (draft pull request, design review). If the request needs a new token, that part is Tier 3:
describe it in the pull request, do not invent a value.

## For developers

```sh
bridge request list                                   # every request, with status and linked pull requests
bridge request list --status requested --component Button
bridge request show 42                                # the request, its component files, linked pull requests
bridge request implement 42                           # the brief on stdout: pipe it, paste it, edit it
bridge request implement 42 --claude                  # start Claude Code in the repo with that brief
bridge request implement 42 --branch explore/pill-buttons   # implement it on an exploration, no pull request to main
```

`--claude` needs [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (`claude` on your PATH). Without it,
the brief is printed with the command to run once it is installed: `claude "$(bridge request implement 42)"`.

In Claude Code with the Bridge MCP server, ask "Which component requests are waiting?" or "Implement request 42".
Claude calls `bridge_list_requests` and `bridge_get_request`, works on `agent/request-42`, and opens a pull request
that closes the issue. If the request is unclear or conflicts with the guidance, it comments on the issue instead
of guessing.

Filing one from a terminal (needs a GitHub token: `GITHUB_TOKEN`, or `gh auth login`):

```sh
bridge request create --component Button --kind new-variant --title "Add a danger ghost variant" \
  --summary "Toolbars need a quieter danger button." --change variant=:danger-ghost --dry-run
```

`--change field=before:after` repeats; `--dry-run` prints the issue without creating it. Exit codes: 0 ok, 1 not a
request (or Claude Code not found with `--claude`), 2 usage or setup error.

## Suggestions

A **suggestion** is a request with the exact change inside: a GitHub issue labeled `bridge-suggestion` whose body
holds the readable change, the checks when it was suggested and a collapsed machine-readable block
(`bridge.suggestion/1`). It is how token, docs, brand, revert, missing piece and Figma changes reach the code when
`"changes"` in `bridge.config.json` is `"suggest"` (the default; `"direct"` opens branches and pull requests
instead). The person who suggests only needs Issues write; a developer applies it with their own access.

| Step | Where | What happens |
| --- | --- | --- |
| 1. Suggest | Studio, the Figma plugin, `bridge propose`, or Claude (`bridge_propose_token_change` and the other writing tools) | An issue titled `Tokens: darken muted text`, labeled `bridge-suggestion`, `suggestion: <kind>`, `source: <where>`, `tier: <n>` and one state label (`suggestion: needs review`) |
| 2. Review | Studio, `bridge review 42 --approve`, or Claude (`bridge_review_suggestion`) | The owners in `bridge.config.json` approve, request changes or decline. A review is a comment bound to the version it saw: an edit of the change makes earlier approvals stale |
| 3. Apply | `bridge apply 42`, or Claude Code with the Bridge MCP server: "Apply Bridge suggestion #42" (`bridge_apply_suggestion`) | Bridge re-applies the change on today's code, re-runs the checks and commits it on a new local branch `bridge/suggestion-42-<slug>` (nothing pushed), and says on the issue that it is being applied |
| 4. Pull request | GitHub | The developer pushes the branch and opens a pull request whose body says `Closes #42` (`bridge suggestions link 42 --pr <n>` or `bridge_link_suggestion` records it). It goes through the usual review and CI |
| 5. Done | GitHub | Merging closes the suggestion |

Status, everywhere: **needs review**, **changes requested**, **approved** (every approval its tier needs, on the
current version), **being applied** (an open pull request says `Closes #n`, or a developer applied it), **applied**,
**declined** (closed as not planned), **outdated** (the code changed since and it no longer applies cleanly).

For developers:

```sh
bridge suggestions                       # open suggestions, with status, kind, tier and linked pull requests
bridge suggestions --status approved     # what is ready to apply
bridge suggestions show 42               # the change, its checks, its version, who approved it, what is missing
bridge apply 42 --dry-run                # the plan and the diff on today's code, nothing written
bridge apply 42                          # one commit on a new local branch, working tree untouched, nothing pushed
bridge apply 42 --write                  # into the working tree instead (refused over uncommitted changes)
bridge apply 42 --patch | git am         # as a patch
bridge suggestions link 42 --pr 57       # record the pull request that applies it
bridge review 42 --approve               # as an owner; --request-changes or --decline with --message "..."
```

`bridge apply` stops, and writes nothing, when the approvals on the current version do not cover the tier (exit 1),
when a check would fail on today's code or the tier went up (exit 1), when a path is unsafe or the machine-readable
block was edited by hand (exit 1; `--accept-edited` once you checked it), or when a change conflicts with today's
code (exit 3). Running it again on code that has the change is a no-op (exit 0). `--force-unapproved` applies
without every approval and says so on the issue.

In Claude Code with the Bridge MCP server (`claude mcp add bridge -s user -- npx -y @bridge-ds/mcp --repo <owner/name>`),
ask "Apply Bridge suggestion #42". Claude calls `bridge_apply_suggestion` with a dry run first, shows you the plan,
applies it on a branch, then opens the pull request that closes the issue. On a remote repo (`--repo`), the tool
returns the files to write instead of writing them.

## Settings

`bridge.config.json`, all optional:

```json
{
  "integrations": {
    "requests": { "labels": ["design-system"], "assignees": ["ds-oncall"] },
    "jira": { "baseUrl": "https://acme.atlassian.net", "project": "DS", "issueType": "Task", "labels": ["design-system"] }
  }
}
```

`requests.labels` and `requests.assignees` are added to every new request issue. `jira` turns the Jira Action on
(with the secrets below). Credentials never go in this file.

## Jira setup

1. Copy `.github/workflows/bridge-jira.yml` into your design system repo. In a repo that is not this one, replace
   the install and build steps and the `node packages/cli/dist/index.js` line with `npx -y @bridge-ds/cli request jira-sync`.
2. Add `integrations.jira` to `bridge.config.json`: your site (`https://<site>.atlassian.net`), the project key and,
   if it is not `Task`, the issue type.
3. Create an API token for a Jira account that can create issues in that project
   (id.atlassian.com, Security, API tokens), then add two repository secrets: `JIRA_EMAIL` (that account's email)
   and `JIRA_API_TOKEN`.

What the Action does:

- **Opened, or labeled `component-change`:** creates the Jira issue (Jira Cloud REST v3, basic auth with the email
  and token): the summary is the issue title, the description holds the summary, the changes and a link back.
  Then it comments `Jira: DS-12 <url>` on the GitHub issue and labels it `jira: DS-12`. An issue that already has a
  `jira:` label is skipped, so a run twice never creates two Jira issues.
- **Closed:** comments `Closed in GitHub (#42), completed` (or `not planned`) on the linked Jira issue. It does not
  move the Jira issue to Done: workflow transition names differ from one Jira site to another. Use a Jira
  automation rule on that comment, or the GitHub for Jira app below, to transition it.
- **Off by default.** Without the secrets, or without `integrations.jira`, it logs one notice line and passes. It
  never comments on issues to say it is off.
- **Permissions:** `issues: write` (the comment and the label) and `contents: read` (checkout). A Jira error fails
  the run with what to check; the GitHub issue is left as it was.

## Using your own tools

Requests are plain GitHub issues, so anything that reads issues can use them:

- **Label filter.** `is:issue label:component-change is:open` in GitHub search, a GitHub Project view filtered on the
  label, or `gh issue list --label component-change`.
- **GitHub for Jira.** The [Atlassian GitHub for Jira app](https://github.com/marketplace/jira-software-github) links
  branches, commits and pull requests to Jira issues that mention the key. Put `DS-12` in the pull request title
  or a commit message, and the Jira issue shows the work and can transition on merge with Jira's own automation.
- **Your own sync.** Skip the Action and point any issue-to-tracker integration at the `component-change` label.
  The hidden `bridge-request` JSON block in each issue body holds the structured request.
