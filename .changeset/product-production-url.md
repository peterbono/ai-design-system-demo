---
'@bridge-ds/core': minor
'@bridge-ds/cli': minor
---

A product in `bridge.config.json` `products[]` can say where it runs in production (`"production": "https://..."`):
the Bridge toolbar shows it as Live product and Studio as the product today. `bridge connect` in a React product now
prints the one line that mounts the Bridge toolbar (`@bridge-ds/toolbar`), says when it is already installed, and
warns when the product has no production URL. It never edits the app's code. The design system adds Product admin
(`admin-app`, peterbono/bridge-product-admin).
