---
title: Prove a version-management fix on real consumer checkouts built from the branch
date: 2026-11-01
category: workflow-issues
module: version-management
problem_type: workflow_issue
component: development_workflow
resolution_type: workflow_improvement
severity: medium
symptoms:
  - "`ConfigMalformed` at the `versioning` field when the branch build runs on a consumer whose release config names a strategy the build no longer decodes"
  - "`ManifestUnreadable` naming the consumer's root directory when the package manager on PATH cannot run the consumer's pinned version"
  - "`UNRESOLVED_IMPORT` for a workspace dependency while building an app alone, then `deno compile` fails on the bundle"
applies_when:
  - "A fix to bump or plan is only observable on a consumer repository's real layout, and the unit's done-when is stated on consumer checkouts"
  - "A consumer's root manifest, release config or pinned package manager differs from every test fixture"
tags: [version-management, consumer-proof, versionless-root, release-config, pnpm, deno-compile, turbo]
---

# Prove a version-management fix on real consumer checkouts built from the branch

## Context

`bump` refused a private root `package.json` that declares no `version`: `VersionIntentMalformed: path=package.json`, raised before any intent was read. `bumpCell`'s read phase called `SurfaceStore.readSurface` on the root manifest target for every strategy, and `SurfaceStoreLive` maps a manifest whose `version` fails the `PackageVersion` decode to that refusal. Under `changesets` versioning the root is not a member and is never written, so the read was a pure liability.

Every suite stayed green while this was live, because no fixture had the failing shape:

- The changesets integration fixture's root manifest carries `"version": "0.0.0"`.
- The surfaces scenarios seed the root path in `makeFakeSurfaceStore` with a version.
- The fake answered any registered path and recorded nothing, so an unwanted read was invisible.

The fix makes the absence structural: `BumpInput` and `BumpCommand.versioning` are unions keyed by strategy, and the `changesets` arm carries no manifest, root changelog or manifest version, so a root read there is a type error. The regression scenario seeds `makeFakeSurfaceStore` with a refused root path and asserts zero reads. The unit's done-when was nonetheless stated on real consumers, and proving it exposed three obstacles that no test shows.

## Guidance

Run the branch-built tool on a throwaway copy of each consumer, one fresh copy per run.

1. **Copy at a pinned commit.** Clone the local checkout and `git checkout <sha>`; edit nothing in the copy. `bump` consumes intents, edits member manifests and creates the changelog directory, so a used copy is no longer the consumer.
2. **Build through the task graph, then package.** The app's own `build` (`tsdown`) bundles with workspace dependencies external, so building the app alone prints `UNRESOLVED_IMPORT` for each unbuilt dependency and the following `package` step (`deno compile` over the bundle) fails. Build with `turbo build --filter=<app>` so dependencies build first, then run the app's `package` script. The binary lands in the app's `dist`.
3. **Make the consumer's pinned package manager the one on PATH.** `WorkspaceStoreLive` shells out to `pnpm ls -r --json --depth=-1` with the consumer root as cwd, and `listMembers` turns any non-zero exit into `ManifestUnreadable` for the root. A consumer whose `packageManager` field pins a major that the PATH `pnpm` cannot launch fails here, with a message that looks like a manifest problem. Check `pnpm ls -r --json --depth=-1` inside the copy first; if it fails, put the pinned binary first on PATH for the run.
4. **Run the unmodified consumer first.** A release config that names a strategy the branch no longer decodes fails with `ConfigMalformed` at `versioning` (the `Versioning` union in `Config.schema` accepts `surfaces` and `changesets` only). That is consumer drift, not a verdict on the fix. Migrate only `versioning.strategy` in the throwaway copy, say so in the evidence, and leave the consumer's own migration to a separate change in the consumer repository.
5. **Record the verdict.** `sha256sum` the root `package.json` before and after, keep the exit code and the tool's output verbatim, and read `git status` for what the run changed.

$$\text{proof} = (\text{exit}=0) \land (h_{\text{before}}(\text{root manifest}) = h_{\text{after}}(\text{root manifest}))$$

Adding a placeholder `version` to the consumer's root satisfies the exit code and defeats the claim. It does not count.

## Why This Matters

The refusal lived in a read that tests could not see, and the consumers that trigger it are the ones the unit exists for. A green suite certifies the fixtures; a consumer run certifies the shape. Obstacles 2 to 4 each look like a failure of the fix (a refusal naming the root, a config error, an unresolved import) and cost a diagnosis loop when met cold.

The same fixture-versus-checkout gap is documented for a missing directory in `docs/solutions/runtime-errors/fixture-seeded-directory-hid-fresh-checkout-bump-failure.md`, and the spawn-needs-PATH mechanism in `docs/solutions/workflow-issues/install-free-check-still-needs-its-tools-on-path.md`.

## When to Apply

- A fix concerns what `bump` or `plan` reads from, or refuses in, a consumer's tree.
- A done-when names consumer checkouts rather than a suite.
- A fixture models a field, file or config that the consumers it stands for might lack.

## Examples

Fixture that hides the read, and the fake that exposes it:

```ts
// hides: every path the code might read is registered, and reads leave no trace
const surfaces = makeFakeSurfaceStore(new Map([[brandPath('package.json'), brandVersion('0.0.0')]]))

// exposes: the root path is refused and every read is recorded
const surfaces = makeFakeSurfaceStore(new Map(), new Set([brandPath('package.json')]))
// ...then: expect(surfaces.state.reads).toEqual([])
```

Anti-pattern smell: a request type that names a file only one strategy needs, which lets another strategy's read path compile. The remedy is a per-strategy arm of the request, so the unneeded read cannot be written.

## Related

- `docs/solutions/runtime-errors/fixture-seeded-directory-hid-fresh-checkout-bump-failure.md`
- `docs/solutions/workflow-issues/install-free-check-still-needs-its-tools-on-path.md`
- `docs/solutions/runtime-errors/pnpm-root-importer-row-fails-member-enumeration.md`
