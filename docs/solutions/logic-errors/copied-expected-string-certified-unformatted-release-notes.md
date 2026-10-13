---
title: A copied expected string certified release notes the format check rejects
date: 2026-10-13
category: logic-errors
module: version-engine
problem_type: logic_error
component: testing_framework
symptoms:
  - "The release pull request the Release (dogfood) run opens fails `check:ci` at `pnpm format:check` (`dprint check` exit 20) on `CHANGELOG.md`"
  - "dprint's diff for every root-changelog bullet removes two leading spaces: `  - <summary>` becomes `- <summary>`"
root_cause: logic_error
resolution_type: code_fix
severity: high
tags: [changelog, root-changelog, dprint, format-check, oracle, release-pr, bump]
related_components:
  - packages/version-engine/src/bump-derive.ts
  - apps/version-management/tests/root-changelog-format.integration.test.ts
---

# A copied expected string certified release notes the format check rejects

## Problem

`version-management bump` appends a `## <version>` section to the root changelog with one bullet per intent (`rootBulletsOf`). It indented each bullet by two spaces before the `-` marker. The release pull request carries that file, and the repository's `check:ci` starts with `pnpm format:check`, which runs `dprint check`. dprint removes the two spaces, so every release pull request failed CI on its first step.

## Failure mechanism

The only test of the root changelog's text compared it to a string the author typed: `'# Changelog\n\n## 2.0.0\n\n  - ship a\n  - fix b\n'`, read from a fake changelog store. A hand-copied expectation reproduces whatever the author believed the output should be. Here it encoded the defect, so the suite stayed green.

The real judge of that file is the consumer's gate: the repository's own `dprint check` with its `dprint.json`.

## Fix

- `rootBulletsOf` writes `- <summary>`.
- The copied-string assertion is deleted, not re-pinned.
- The version-management app's feature "Release notes in the root changelog pass the repository format check" runs the real `bumpCell` over the real workspace stores in a temporary repository and runs `bin/dprint check --config <repository>/dprint.json CHANGELOG.md` on the result. It runs once with no changelog and once with an earlier release. On the pre-fix commit both rows fail in CI's `check` job with dprint's diff.

## A format oracle needs a content assertion beside it

dprint also accepts a changelog whose summaries lost their `-` marker: plain paragraphs are well formatted. The feature therefore also requires each summary on its own line starting with `-`, and requires the earlier release to survive the append. A passing format check alone cannot show either.

## Where the test lives

The oracle needs the flake's dprint binary and its plugins, which `dprint.json` loads from `plugins.dprint.dev`. The CI `check` lane has both because `format:check` runs before `turbo test`. The Sandbox lane is offline and tests only `./packages/*`. So the feature lives in the version-management app, and that package's `turbo.json` adds `dprint.json`, `bin/dprint` and `nix/dprint.nix` to the `test` inputs after `$TURBO_EXTENDS$`, so a formatter change re-runs it.

## Invariant

**Text the product generates for a consumer's repository is judged by that consumer's gate, not by a copy of the expected text.**

- wrong: `expect(rootChangelog).toEqual('# Changelog\n\n## 2.0.0\n\n  - ship a\n  - fix b\n')`.
- right: run the real writer, run the repository's own `dprint check` on the file, and assert the content the gate cannot see (each bullet's marker, the earlier release).

Gate: review, backed by the feature "Release notes in the root changelog pass the repository format check".

## Related

- `docs/plans/2026-10-13-1812-fix-root-changelog-bullets-pass-dprint-plan.md`
- `docs/solutions/runtime-errors/fixture-seeded-directory-hid-fresh-checkout-bump-failure.md`
- `docs/solutions/logic-errors/lint-gate-passes-while-linting-nothing.md`
