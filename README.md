# Carbon, measured (test branch)

Test fixture for the DS Bridge Figma plugin, never merged. Everything here comes from Carbon's public Storybook
(react.carbondesignsystem.com) through `bridge specs --measure --variants --states --tokens --shots`:

- `tokens/`: the CSS custom properties the measured stories use, as a two-tier DTCG repo (core `tokenRepoFromMeasure`),
  one semantic file per Carbon theme (white, g10, g90, g100).
- `measured-specs.json`: the measure, its values pointing at those tokens.
- `measured-shots/`: each story's render, the reference for Check fidelity.
