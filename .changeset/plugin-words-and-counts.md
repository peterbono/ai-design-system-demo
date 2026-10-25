---
'@bridge-ds/figma-plugin': patch
'@bridge-ds/core': patch
---

The plugin speaks in designer words, with one count per list:
- **After connecting:** the plugin lands on Pull, "Get your design system", says "Connected to …" once, and offers "Check for updates".
- **Components:** one count and one noun ("62 components to add") instead of "47 of 47 … (62 sets …)". Up-to-date lists become counts. Drafted-with-Claude, layout helpers and motion notes go under For developers.
- **Pull results:** "1 edited token" instead of "1 edited", and one sentence for what a pull built ("1 component updated on the Components page."). The theme layout moves under For developers.
- **Edits already sent:** Pull lists them as "in review", with "See it in Studio", not "Send them from Push".
- **Connecting from Pull or Push:** the action reads "Connect your design system" instead of "Open Settings".
- **Push:** the steps no longer say "synced variables", "build request" or "Token values ship".
- **Core:** a warning that existed before the edit reads "Already in the design system" instead of "Already on main". Icon library parts ("lucide") read "icon" in gap sentences.
