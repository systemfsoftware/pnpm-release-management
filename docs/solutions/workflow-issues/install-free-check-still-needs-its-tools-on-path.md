---
title: An install-free check still needs every tool it spawns on PATH
date: 2026-10-13
category: workflow-issues
module: process-adapter
problem_type: workflow_issue
component: development_workflow
symptoms:
  - "`pnpm could not be started: ENOENT (NotFound: ChildProcess.spawn (pnpm ls -r --json --depth=-1))` from the reusable changeset check"
  - "The e2e changeset-check phase fails with `the e2e evaluates only && of comparisons and negations in if:, got: always()`"
root_cause: incomplete_setup
resolution_type: workflow_improvement
severity: high
tags: [changeset-check, install-free, pnpm, turbo, e2e-harness, always, ci-wall-clock]
related_components:
  - .github/workflows/changeset-check.yml
  - e2e/workflow-env.ts
---

# An install-free check still needs every tool it spawns on PATH

## Problem

The reusable changeset check stopped installing the caller's workspace: under the `turbo` gate strategy, change evidence now fetches the pinned `@turbo/<os>-<arch>` binary itself (`fetchTurbo`). The pull request that made that change also deleted the package-manager setup steps (`pnpm/action-setup`, `actions/setup-node`, `pnpm/setup`), because the check no longer runs `pnpm install`. Its first CI run failed at the check step with `pnpm could not be started: ENOENT`.

## Failure mechanism

1. "Installs nothing" was read as "needs nothing". The Nix-built `changeset-management` is a standalone executable and needs no node, but member enumeration (`WorkspaceStoreLive`) spawns `pnpm ls -r --json --depth=-1`. That command reads only the workspace manifest and needs no install, but it needs `pnpm` itself.
2. The local smoke ran the check from a normal shell, where `pnpm` was on `PATH`, so it passed. Only CI's runner, with the setup steps gone, had no `pnpm`.
3. The same change gave the job the wall-time summary step that `one-stuck-job-backstop` prescribes (`if: always()`). The e2e harness replays a reusable workflow's `run:` steps through its own `if:` evaluator (`conditionHolds`), and it accepted only `&&` of comparisons. It refused `always()` and failed the e2e lane on a workflow GitHub accepts.

$$\text{tools a step needs} = \text{tools it spawns, transitively} \supsetneq \text{tools it installs}$$

## Fix

- The package-manager setup steps came back unchanged; only the install and the dev shell stay removed. The verdict step now takes about 1.5 s on CI, Turbo fetch included.
- `conditionHolds` accepts `always()`, and the harness `job` runner keeps going after a failed step, running only steps that `runsAfterFailure`, as the GitHub runner does.

## Architectural invariant

**Before deleting a setup step, prove the command still runs without what that step provides.** Smoke the command with an environment holding only what the job will still provide.

- wrong: run the check from a developer shell, see it pass, delete `pnpm/action-setup`.
- right: run the built check under `env -i HOME=… PATH=<dir holding only git>` against a fresh clone. The ENOENT shows up before the push.

Gate: review, backed by the pull request's own Changeset lane, which calls the reusable check exactly as consumers do.

A second rule for this repository: a workflow change can be correct for GitHub and still fail the e2e lane, because the harness interprets `if:` conditions and pins each reusable job's `run:` step labels. Any new `if:` shape or step in a reusable job needs a matching change to the harness and the phase that lists its steps.

## Related

- `docs/plans/2026-10-13-1013-feat-changeset-check-fetches-pinned-turbo-plan.md`
- `docs/solutions/runtime-errors/pnpm-root-importer-row-fails-member-enumeration.md`
- `docs/solutions/workflow-issues/local-check-ci-runs-the-container-e2e-after-an-e2e-edit.md`
