---
'@bridge-ds/core': minor
'@bridge-ds/cli': minor
'@bridge-ds/mcp': minor
---

The owner override covers suggestions. An owner `governance.override` allows, whom nobody else can review, approves their own suggestion as owner with a written reason: core `overrideSuggestionOnGitHub`, `composeSuggestionOverrideComment`, `parseSuggestionOverrideComment`, `suggestionOverrideProblem` and `suggestionOverrideOf`, and `summarizeSuggestionApprovals` counts it as every missing approval on its version (`SuggestionGovernance.override`). `bridge review <n> --override --message "..."` and `bridge_review_suggestion` with event `override` do it; `bridge suggestions show` and `bridge_get_suggestion` say "Approved with the owner override by @login".
