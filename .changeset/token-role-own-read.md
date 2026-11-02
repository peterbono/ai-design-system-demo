---
"@bridge-ds/docs-site": patch
---

A GitHub admin signed in with Bridge (suggest) shows Admin on their team again, never "Can view" or the read-only strip: the repository's own read (its permissions are the viewer's) goes to GitHub with their token instead of Bridge's shared read, access kept from older reads is read again, and the role shown is the stronger of the GitHub sign-in and the account's linked GitHub role.
