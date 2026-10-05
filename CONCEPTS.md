# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Workspace

### Workspace member

A package the workspace declares as part of the repository's build and release unit. A member carries a manifest that names it and versions it. Only members are enumerated, versioned, or released; the repository root is not a member even though it carries a manifest.

### Hybrid member

A member that carries two identities: the workspace's own declaration and an npm manifest. The npm identity is what node-style resolution — type-aware linting, the TypeScript checker — uses to find the member. A member with only the workspace identity is invisible to those tools while the workspace's own checker still resolves it, so the two checkers disagree about the same file.

### Root manifest

The manifest at the repository root. It declares the repository's own metadata rather than a member's, and where the package manager is pnpm it holds the dependency graph that task-level resolution consults before any task in the workspace runs.

### Root-importer row

In a recursive package-manager workspace listing, the extra row describing the repository root rather than a member. It has no member directory, so its path relative to the root is empty — a value no member path can legitimately be.

### Release-age window

The minimum age a published dependency version must reach before the dependency resolver will accept it. A pin to a version younger than the window fails resolution for the whole workspace at once, because the root dependency graph is resolved before any task is dispatched.

## Flagged ambiguities

- "Root" always means the repository root: the root manifest is not a member manifest, and the root-importer row is not a member.
