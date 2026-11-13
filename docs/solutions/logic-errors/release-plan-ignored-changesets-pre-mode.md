---
title: The release plan ignored changesets pre-release mode and versioned pre-releases as stable
date: 2026-11-13
category: logic-errors
module: packages/changesets-adapter (ChangesetsPortLive)
problem_type: logic_error
component: release
severity: high
symptoms:
  - A consumer on an alpha or beta line gets a release PR that bumps 6.0.0-alpha.64 to 6.0.0
  - .changeset/pre.json has no effect on version-management bump
tags:
  - changesets
  - pre-release
  - release-plan
---

# The release plan ignored changesets pre-release mode and versioned pre-releases as stable

## Problem

`ChangesetsPortLive` called `assembleReleasePlan(changesets, packages, config, undefined)`. The fourth argument is the pre-release state, so pre mode was never read. A consumer whose packages are on a pre-release line got a release PR that moved every package to a stable version. A consumer that ran `changeset pre enter beta` still got stable versions.

## Fix

Read the state with `@changesets/pre`'s `readPreState(root)` and pass it to `assembleReleasePlan`. `@changesets/apply-release-plan` already handles pre mode once the plan carries it.

## Evidence

On a copy of a consumer with six packages on alpha versions, after `changeset pre enter beta`, `version-management bump` now writes `6.0.0-beta.65`, `0.1.0-beta.8`, `7.0.0-beta.5`, `5.0.0-beta.6`, `2.1.0-beta.4` and `2.0.0-beta.2`. Before, the same intents produced `6.0.0`, `0.1.0` and so on.

## Prevention

When adapting a library entry point, read every parameter it takes. An `undefined` passed for a state argument turns a feature off without any error.
