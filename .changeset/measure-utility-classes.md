---
"@bridge-ds/core": patch
---

Measure: utility classes (Tailwind's `px-4`, `hover:bg-x`, `w-[42px]`, CSS-in-JS hashes like `css-1x2y3z`) never name
or pair a part. A part named only by utilities takes its tag, numbered in order, so the same structure gives the same
ids in every variant. BEM and semantic classes still name parts: Carbon's ids do not change.
