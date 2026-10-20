---
"@bridge-ds/figma-plugin": patch
---

Pull no longer hides every component when one value in component-specs.json has a shape the plugin does not read: that field is listed with the others that cannot be bound ("update DS Bridge") and the rest pull as usual. Reactions stored by an older DS Bridge in an unexpected shape are read as none. When components cannot be read, the callout now says what happened and what to do ("Check again, and if it keeps failing, update DS Bridge and report it with the details below"), with the technical error folded under Details instead of shown as the message.
