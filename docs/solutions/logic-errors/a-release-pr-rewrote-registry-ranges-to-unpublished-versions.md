---
title: A release PR rewrote plain registry ranges on sibling packages to the versions it had not published yet
date: 2026-11-15
category: logic-errors
module: changesets-adapter
problem_type: logic_error
component: development_workflow
symptoms:
  - "The release PR's CI failed at pnpm install --frozen-lockfile: specifiers in the lockfile don't match specifiers in package.json"
  - "The mismatch named sibling packages: lockfile ^22.0.0, manifest ^22.0.1 — the version the same PR releases"
root_cause: config_error
resolution_type: code_fix
severity: high
tags: [changesets, release-pr, pnpm, workspace-protocol, dogfood]
---

## Problem

A repository that dogfoods its own released packages devDepends on a sibling's name with a plain range, such as `"@scope/tool": "^22.0.0"`. pnpm's `linkWorkspacePackages` defaults to false, so that range resolves from the registry: it names a release already published. `version-management bump` rewrote it to the version the release PR was about to publish (`^22.0.1`). No lockfile can resolve that before the PR merges and publishes, so the release PR's frozen install failed.

## Cause

The changesets adapter builds the changesets config in code and did not set `bumpVersionsWithWorkspaceProtocolOnly`. Without it:

- `@changesets/apply-release-plan` (`getDependencyVersionEdits`) rewrites any valid semver range on a workspace package's name;
- `@changesets/get-dependents-graph` counts that edge as a dependent, so `updateInternalDependents: 'always'` patch-released the dogfooding package too.

## Fix

The adapter's config sets `bumpVersionsWithWorkspaceProtocolOnly: true`. A `workspace:` range, peer ranges included, is still rewritten and still makes its package a dependent. A plain range is left alone and is not an edge. The same config object feeds both `assembleReleasePlan` and `applyReleasePlan`.

Refreshing the lockfile in the release PR instead (`pnpm install --lockfile-only`) cannot work, because the version it would resolve is not on the registry until the PR merges.

A repository that sets `linkWorkspacePackages: true` and relies on plain ranges being linked and bumped would need `workspace:` ranges; none of the repositories on the shared workflow sets it.
