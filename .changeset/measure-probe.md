---
'@bridge-ds/core': patch
'@bridge-ds/cli': patch
---

Measure args reach the story: when Storybook drops URL args it cannot validate (a story that declares no args, like Carbon's Button), the measure sends them the way the Controls panel does and waits for the re-render. `--variants` probes a boolean with both values, compared with each other, so a story that renders the non-default value (a toggle shown on) keeps its axis.
