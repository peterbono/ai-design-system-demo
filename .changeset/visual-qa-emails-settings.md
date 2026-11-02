---
"@bridge-ds/docs-site": patch
---

Visual QA of emails, Account > Email, Settings and the Claude consent page. Every Bridge email (notifications,
sign-in code, invites, join requests, library sign-in) shares one shell: the Bridge name, a preheader, layout tables,
a bulletproof 44px button (full width on a phone), the token palette and dark mail apps. Notification emails name
the person by their GitHub profile name when they have no Bridge account, show titles as Studio does ("Add a toast
alert"), and quote the start of a question or a lead's review note (never kept for the summary). The unsubscribe page
gets the Bridge name, a title per state, dark mode and a way back to Bridge. Account > Email lays its two choices out
in equal columns, one column on a phone, with Rename and Change kept on their line. The invite dialog keeps addresses
on one line on a phone, puts Resend on the person's line as in Settings, and shows a row's notice by the list. The
GitHub usage meter turns warning-toned when GitHub asked Bridge to slow down. The Claude consent page shows the drawn
face, never initials, and no longer says "signed in with GitHub" before GitHub has asked. Welcome back has one
action, "Continue", with the person named once in an information-only identity line (no border, no tile). In Start
an exploration, an admin whose product Bridge cannot open is told to set it up ("Set up Bridge on <product>"), never
to ask an admin.
