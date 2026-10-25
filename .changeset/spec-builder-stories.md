---
"@bridge-ds/core": patch
"@bridge-ds/react": patch
---

Component specs count height and width as the content box (a bordered table cell is its height plus its border), the Figma build draws an empty sized slot at its padding instead of 100px, and stories reach every Figma variant: a disabled control on IconButton, Input, Select, Combobox and Textarea, and Figma variant stories for AccordionItem, MenuItem, MenuCheckboxItem, MenuSubmenu and TableEmpty.
