---
title: Local check:ci runs the container e2e after an e2e edit; prove that suite in CI
date: 2026-10-12
category: workflow-issues
module: e2e
problem_type: workflow_issue
component: testing_framework
severity: medium
applies_when:
  - "A change edits the e2e package, so turbo misses the cache for @systemfsoftware/e2e#test"
  - "Local pnpm check:ci fails only in @systemfsoftware/e2e#test after such an edit"
symptoms:
  - "@systemfsoftware/e2e#test fails with `Test timed out in 600000ms` while every other check:ci task passes"
  - "An unhandled `ENOENT ... lstat .../apps/changeset-management/dist/main.js` is reported from tests/pipeline.integration.test.ts"
tags: [e2e, check-ci, turbo-cache, testcontainers, ci-only]
---

# Local check:ci runs the container e2e after an e2e edit; prove that suite in CI

## Problem

`pnpm check:ci` runs the workspace `test` task, which includes `@systemfsoftware/e2e#test`, the testcontainers suite (`Session.open` / `makeWorld`) that drives the whole release pipeline in a container. While no e2e input changes, turbo replays that task from cache, so a local `check:ci` looks like a complete, fast gate. Editing any e2e input invalidates the cache, and the next local `check:ci` really runs the container suite.

On a local machine without a Docker daemon (rootless podman here), that run failed at the e2e vitest `testTimeout` of 600 s and reported an `ENOENT` for the `changeset-management` app bundle. The e2e package depends on no app, so its `^build` never builds them, while other `test` tasks in the same concurrent turbo run rebuild the apps' bundles. A read during that rebuild is the likely cause; this is inferred from the error and was not isolated.

## Failure mechanism

1. The turbo cache hides the e2e suite until an e2e input changes.
2. The cache miss starts testcontainers locally, against a container runtime that CI does not use.
3. The e2e task has no dependency edge to the apps whose bundles it reads, so concurrent rebuilds can race it.

## Why This Works

The invariant is that container e2e results come from CI, on the runtime the suite targets. On a pull request, CI's Gate job (the same `check:ci`) and the E2E workflow both ran the edited suite green on GitHub's Docker host. The E2E workflow sets no `E2E_FILTER`, so every `session.phase` runs inside its one test, and a failing assertion in any phase fails that test.

## Guidance

- Treat a local `@systemfsoftware/e2e#test` failure after an e2e edit as unproven, not as a regression. Gate: the turbo summary's `Failed:` line names that task alone.
- Verify the edit locally with the gates the local machine can run. Gate: `pnpm typecheck` and `pnpm lint` exit 0.
- Prove the suite in CI and read its verdict from the run's summary artifact. Gate: the E2E workflow's `containerised release pipeline` job succeeds.
- Wrong: rerunning local `check:ci` until the e2e passes, or reporting the change broken. Right: confirm every other task passed, then cite the CI E2E job.

## When to Apply

Any change that adds or edits an e2e phase, the fixture, or the harness. It does not apply when the local run has a real Docker daemon and the apps already built, which is the setup where the suite can pass locally.

## Related

- `docs/solutions/workflow-issues/read-the-e2e-summary-artifact.md`: how to read the e2e run's own verdict.
