---
"@bridge-ds/core": patch
"@bridge-ds/visual": patch
"@bridge-ds/cli": patch
---

Figma references: one variant that fails to render no longer skips every variant after it. The reference story catches a render error and shows it as that variant's skip reason, and the capture reloads the story if Storybook still lands on its error screen. Parts of a compound component (AccordionItem, Radio, menu items, SidebarNavItem, TableEmpty) render inside their parent (`within` in the render plan) and are captured alone, at the width Figma draws them. Menu parts render the part itself instead of the Menu root, and a capture that comes out invisible is skipped with a reason instead of saved as a blank image.
