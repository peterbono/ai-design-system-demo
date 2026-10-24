---
"@bridge-ds/core": patch
---

Measured only: a frame bigger than its children plus its padding on an axis its parent does not size keeps its measured
size (a 48 px button around a 16 px icon, a 24 px label row around a 16 px label), read from the boxes when the measure
did not mark it as sized.
