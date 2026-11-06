# The component map

**For designers:** when your design system lives in Figma, Bridge links each Library component to its Figma component.
Explore in Claude, then go back to the right component in Figma. A lead or an admin sets the team's Figma file once in
Studio (Settings, Figma file), then asks Claude: "Link our Library components to Figma with Bridge." Claude proposes the
links and a person approves them like any change. A component page then shows "In Figma: Button" with a link; until
then, leads and admins read "Not linked to Figma yet" and the next step, everyone else sees nothing.

Tokens already carry a stable Figma and code identity (`packages/core/src/id-map.ts`, `com.dsbridge.id`). Components
were matched by name only (the measure, `figma-fixes.json`). The map is the first building block that names both sides.

## Where it lives

| What | Where | Set by |
| --- | --- | --- |
| The team's Figma file | `figma.file` in `bridge.config.json` (a link or the file key) | Studio, Settings, Figma file: a pull request on the config, like the team name |
| The map | `bridge.components.json` at the design system repo root | `bridge_propose_component_map`, reviewed like any change; or by hand |

A repository file, not Bridge storage: every link has a diff, a reviewer and a history. Code:
`packages/core/src/component-map.ts` (types, validator, proposer, merge) and `packages/core/src/figma-file.ts`
(reading a Figma link), both pure and browser safe.

```json
{
  "version": 1,
  "components": {
    "Button": {
      "figma": {
        "file": "AbCdEf0123456789",
        "key": "<component set key>",
        "node": "12:34",
        "name": "Button",
        "properties": { "Size": { "prop": "size", "values": { "Small": "sm", "Medium": "md" } }, "Loading#3:0": { "prop": "loading" } }
      },
      "code": { "import": { "package": "@acme/react", "export": "Button" } },
      "stories": ["actions-button--primary"]
    }
  }
}
```

The component id is the Library name, as `bridge_list_components` gives it. `figma` needs `file` and `key` (component
or component set) or `node`; `name` only when Figma names it differently. `properties` maps a Figma property to the code
prop it sets, and each variant value to its code value. Every side is optional: this repository starts with the code
side only (`import`), and no Figma side until a person links it.

## Proposing links

`bridge_propose_component_map` takes the Figma components Claude read through the Figma connector (name, key, node id,
variant properties, as the Plugin API's `componentPropertyDefinitions` gives them) and the file (default: `figma.file`).

1. **Match by name**, ignoring case, spaces, dashes and the page path (`Forms/Text input` is `TextInput`). Variants
   (`Size=sm`) and private parts (`.base`, `_icon`) are not components.
2. **Then by variant properties** when several Figma components share a name: the one whose properties map to the most
   code props wins. A tie is reported as ambiguous, never guessed.
3. **Properties** map only to a code prop of the same name, values only to a code value of the same name (or true and
   false for a boolean prop). The rest is listed as left out.
4. **Merge.** A component a person already linked keeps its link; the proposal adds the others.

It answers `{ proposed, unmatched, ambiguous }` and opens the file for review: a suggestion (kind `config`, label
`component-map`) in suggest mode, a `bridge/component-map-<date>` branch and a draft pull request in direct mode.
Never main. `dryRun` shows the file. Through the hosted connector, members who joined with their email are refused it:
the leads change the library.

## Reading it

- `bridge_list_components` and `bridge_get_component` add `figma`: `{ name, url }`, or `"not linked to Figma yet"`.
- `bridge check` reports how many components are linked and lists the others. An invalid file fails the check (exit
  1); a component not linked yet never does.
- The repo model (`loadRepoModel`) reads the file as `componentMap`, so the hosted Library (from the team's snapshot)
  and Bridge's own Library show the same line on each component page.

## Putting an exploration in Figma

**For designers:** say "Put this exploration in Figma" to your Claude, or use Send to Figma on the exploration page in
Studio (shown to people who can edit, when the team has a Figma file). Your Claude builds it in a new page of the
team's Figma file with real components, then gives you the page link and says what it could not express.

Bridge never writes to Figma and holds no Figma token: the designer's Claude does it with its own Figma connector.
`bridge_exploration_to_figma` (read only, Can edit and Admin, email members included) takes a ref (`admin-app#1`) and
returns the Figma file, the page name, the source of the changed screens, each Library component they use with its
map entry (a part like `CardBody` counts as `Card`), the components with no link, the product's own components, the
preview, the gaps and the recipe. No `figma.file`: one sentence pointing to Settings, Figma file.

- **Ids and files.** A `node` works only inside the file that holds it. From another file a component needs its `key`
  and a published Library; a link with neither is listed as not linked, never faked. So
  `bridge_propose_component_map` should get keys whenever the connector gives them. Links already in the map keep
  what they have.
- **The preview is the visual reference.** Source alone misses the data, spacing and states on screen: Claude looks
  at the preview when it can and says so when it cannot.
- **The result.** While it is explored, Claude saves the page link with `bridge_save_exploration` (`notes.figmaPage`,
  a `## In Figma` section of the note file) and Studio shows "See it in Figma". After Done exploring the notes have
  gone to the developers, so the link stays in the conversation.
