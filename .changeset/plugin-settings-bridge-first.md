---
'@bridge-ds/figma-plugin': patch
---

Settings, once connected, is one card: the design system by its name and how this computer is connected, with a few actions.
- **Signed in with Bridge:** "Connected with Bridge as <name>", with Open in Studio, Switch design system (reopens the team pick in Studio) and Sign out.
- **A token pasted before Sign in with Bridge existed:** the same card, with one primary action, "Sign in with Bridge" ("Connect through your team's Bridge account. No token to manage."). Signing in replaces the old token on this computer.
- **For developers:** the repository field, the branch, the token card and Replace token move under For developers, read-only, with "Edit the connection" for developers. A token a developer chose to paste is marked as their choice and not nudged.
