# Licensing

Bridge's code is public. Two licenses apply, depending on the directory.

## MIT: what you ship in your own product

These packages go into your product and your own tooling, so they stay under the MIT license
(see the `LICENSE` file in each one):

| Directory                   | Package                       |
| --------------------------- | ----------------------------- |
| `packages/core`             | `@bridge-ds/core`             |
| `packages/react`            | `@bridge-ds/react`            |
| `packages/tokens`           | `@bridge-ds/tokens`           |
| `packages/stylelint-plugin` | `@bridge-ds/stylelint-plugin` |
| `packages/eslint-plugin`    | `@bridge-ds/eslint-plugin`    |

## FSL-1.1-MIT: everything else

Everything else in this repository is under the Functional Source License, version 1.1, with the MIT
license as its future license (FSL-1.1-MIT, see `LICENSE` at the root and in each directory below):

| Directory            | What it is                                           |
| -------------------- | ---------------------------------------------------- |
| `apps/docs-site`     | Bridge Studio, the site and its functions (`/api`, `/mcp`, `/oauth`) |
| `apps/figma-plugin`  | The Bridge Figma plugin                              |
| `apps/admin`         | The admin demo                                       |
| `packages/cli`       | `@bridge-ds/cli`                                     |
| `packages/mcp`       | `@bridge-ds/mcp`                                     |
| `packages/visual`    | `@bridge-ds/visual`                                  |
| Root files, `scripts`, `templates`, `docs`, `deploy` | Tooling and documentation |

## What the FSL allows, in plain words

You may read, audit, copy, change and run this code for any purpose except a competing use. That includes:

- using it inside your company, including hosting your own copy for your own teams;
- non-commercial education and research;
- professional services for a company that uses Bridge under these terms.

A competing use is making it available to others in a commercial product or service that replaces Bridge or
offers the same or substantially similar features.

Each version becomes available under the MIT license two years after it is published.

The `LICENSE` file is the reference. This page only summarizes it.

## Versions published before the change

Versions published before this change were released under the MIT license and stay under it.
