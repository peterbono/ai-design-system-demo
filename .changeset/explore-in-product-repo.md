---
'@bridge-ds/core': patch
'@bridge-ds/mcp': patch
'@bridge-ds/cli': patch
'@bridge-ds/docs-site': patch
'@bridge-ds/figma-plugin': patch
---

Explorations for a product with its own repository (`products[].repo`) are now created in that product repository by default: the `explore/<name>` branch and its draft pull request live where developers already work, and the library arrives as the npm package. Studio's "Create branch", `bridge_start_exploration` and `bridge explore start` share the rule (`productRepoOf`, `productRepoAccess`). When Bridge cannot reach the product repository, Studio says so in one line with "Ask an admin to connect <product>" and starts it in the library only if the person picks "Start in the library instead"; Claude gets the same message and asks before using `where: "library"`, the CLI takes `--in-library`. The purpose of an exploration is now optional everywhere: nobody is asked for a brief, and Claude starts one as soon as a designer says they want to explore.
