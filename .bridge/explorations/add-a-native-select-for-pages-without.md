# Exploration: Add a native Select for pages without React

Studio's request form is static markup with vanilla scripts, so the DS Select (a React component that needs hydration) cannot be used there; the Kind field stays a plain native select (PR #79). A native appearance of Select (a styled <select> with DS tokens, focus ring, sizes, invalid and disabled states, usable from plain HTML via a class or a tiny web component) would let static pages stay 100% DS. Same need may exist in other non-React product pages.

- Branch: `explore/add-a-native-select-for-pages-without`
- Started: 2026-10-18 by @peterbono

This file marks the branch as an exploration. It is never merged as is: promoting the pull request to review removes it.
