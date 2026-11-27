---
title: Turning off private-package versioning suppressed a private member a change intent named
date: 2026-11-27
category: logic-errors
module: packages/changesets-adapter (ChangesetsPortLive)
problem_type: logic_error
component: release
severity: high
symptoms:
  - `version-management bump` refuses an intent on a private member with `VersionPrivatePackage`
  - A cargo surface bound to a private member never moves, so the crate never gets a release
  - `tests/changesets.integration.test.ts > An intent on a private member moves a cargo surface bound to it` fails with `expected a bump, got VersionPrivatePackage`
tags:
  - changesets
  - private-packages
  - release-plan
  - surfaces
---

# Turning off private-package versioning suppressed a private member a change intent named

## Problem

A private member that a change intent names was versioned, its surface followed it and a cargo crate bound to it got the release. That is the supported way to release a crate whose version follows a private npm member.

A release also versioned every `private: true` member that merely depended on a released package, and wrote it a CHANGELOG. The fix for that set changesets' `privatePackages: { version: false }`. The option is not scoped to dependents: `@changesets/assemble-release-plan` skips every private package it is told about, including one a changeset names, so the cargo surface scenario stopped moving. A later change then refused such an intent up front as `VersionPrivatePackage`, which turned the silent drop into a refusal. The version-engine suite went red and stayed red on the trunk.

## Fix

Set `privatePackages: { version: true, tag: false }` and pass every private member that no pending intent names in the config's `ignore`. Changesets then skips those members in both `flattenReleases` and `determineDependents`, so a private dependent is still never versioned, never rewritten and never given a CHANGELOG entry, while a private member an intent names is versioned and its bound surface moves. A private member an intent names but that declares no `version` is still refused as `VersionPrivatePackage`, because there is nothing to bump and changesets would throw on the absent old version.

## Evidence

- `packages/version-engine/tests/changesets.integration.test.ts` — 5 passed, including `An intent on a private member moves a cargo surface bound to it`.
- `packages/changesets-adapter` 4 passed, `packages/workspace-adapter` 10 passed, `apps/version-management` 5 passed.

## Prevention

A library option whose name describes a package class (`privatePackages`) applies to every member of that class, not to the one relationship that motivated it. Before adopting it, check what else the class covers: here the same option carried the private-dependent fix and the named-intent capability, and the existing integration scenario caught the loss only after it reached the trunk.
