---
title: The changeset check compares an unreleased package's flake-built tarball with its release tag - Plan
type: feat
date: 2026-10-13
topic: pr-time-tag-digest-check
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
execution: code
---

# The changeset check compares an unreleased package's flake-built tarball with its release tag - Plan

## Goal Capsule

- **Objective:** a pull request that changes a released package's tarball without releasing it is refused before merge, by the same comparison `github-release-management plan` makes after merge.
- **Means:** the reusable changeset check asks the release tools which affected packages will release nothing. Only when that set is non-empty does it build the caller's `.#workspace-tarballs` and compare each one with the integrity its release tag records.
- **Product authority:** the repository's root. Plan integrity rules are unchanged, and no remote tag is created, moved or rewritten.

## Product Contract

### Problem Frame

`changeset-management check` accepts a changed publishable package once any intent names it, `none` included. `plan` runs after merge, on `main`, and only there compares an unreleased package's tarball with the integrity its tag records (`TagIntegrityMismatch`). A wrong `none` therefore passes review and turns the Release run on `main` red. The same holds for a package the diff affects that no intent names and whose tarball changed.

### Requirements

- **R1.** At pull-request time, every package that meets all four conditions is checked:
  - the diff's change evidence names it as touched (Turbo's under `"strategy": "turbo"`, directory classification under `"paths"`);
  - it is publishable;
  - a remote release tag exists at its current version;
  - the pending intents give it no release, because its rows are all `none` or no intent names it.
- **R2.** Each such package's tarball from the caller's flake (`nix build .#workspace-tarballs`, the derivation `release.yml` tags from) must match what its release records. That is the ledger's `published` state when the ledger has one, otherwise the tag annotation. The rules are exactly `plan`'s:
  - a lightweight tag is refused;
  - a burned version is refused;
  - a moved ledger tag is refused;
  - a mismatch names the package, both integrities and the first differing file.
- **R3.** When no package meets R1, no tarball is built. The job adds one evidence pass and no Nix build.
- **R4.** The refusal is one stable line naming the package, its tag and the fix: give the package a real bump, or revert the change to it.
- **R5.** `plan`'s behaviour is unchanged.

### Acceptance Examples

- **AE1 (wrong none, real release).** In the container e2e, after the fixture's 1.1.0 release is tagged with recorded integrity, a change to `@e2e/alpha` carries an intent with `"@e2e/alpha": none`. The changeset check job builds the stubbed `.#workspace-tarballs` from the changed tree and fails with the refusal naming `@e2e/alpha@v1.1.0`. Before this change the same job passes. Covers R1, R2, R4.
- **AE2 (nothing at risk, no build).** The existing e2e phase whose intent gives `@e2e/alpha` a minor bump runs the job. The digest-candidates step reports none, and the tarball step is skipped. Covers R3.
- **AE3 (engine).** An integration feature over the published cell covers three cases:
  - a `none` row whose tarball matches the annotation passes;
  - a `none` row whose tarball differs is refused with `TagIntegrityMismatch`;
  - a package with a non-`none` planned release is not checked.
    It uses the real tarball reader on real `.tgz` files and the cell's real ports. Covers R1, R2.
- **AE4 (real repository).** The Nix-built tools run in this repository on a branch that changes a released package under a `none` intent, with the flake-built tarballs, and the verdict is recorded. Covers R2.

### Scope Boundaries

- No change to `plan`, the ledger, tags, `release.yml` or `tag`.
- The 11 lightweight `v0.0.0` tags stay as they are. A pull request that leaves such a package unreleased while changing it is refused (`TagAnnotationLightweight`), exactly as `plan` would refuse it after merge.

## Planning Contract

### Key Technical Decisions

- **KTD1. The comparison is `plan`'s, extracted once.** The per-member resolution in `plan.ts` (ledger state, ledger tag commit, annotation parse, digest lookup) moves into one exported function in `github-release-engine`. `plan` and the new cell both call it, and `verifyIntegrity` decides. There is no second copy.
- **KTD2. A new `digestsCell` in `github-release-engine`, with two modes.**
  - Without tarballs, it returns the at-risk names, so the workflow can decide whether to build.
  - With tarballs, it returns the verdict.
  - It needs `ChangeEvidencePort`, `WorkspaceStore`, `ChangesetsPort`, `GitPort`, `LedgerPort` and `TarballPort`, all already composed by `github-release-management`.
- **KTD3. CLI:** `github-release-management digests <base> [--tarballs <dir>]`. The list mode prints the at-risk names on stdout, one per line. The verify mode prints `tag digests: N package(s) match their release tags` or the refusal.
- **KTD4. Workflow.** `changeset-check.yml` gains two steps after the intent verdict, so the first verdict comes no later than today:
  1. a list step that writes `packages` to `$GITHUB_OUTPUT`;
  2. `if: steps.digests.outputs.packages != ''`, `nix build --no-link --print-out-paths .#workspace-tarballs`, then the verify mode.

  There is no dev shell, and the release tools run as built (ci-wall-clock `no-dev-shell-on-verdict-lanes`, `light-checks-run-the-pinned-tool`). The Turbo evidence scopes the work (`pr-gate-runs-only-what-the-diff-affects`). The build runs only when the diff changes a released package's inputs, which is one of the two cases `setup-under-a-minute` allows.
- **KTD5. Measured cost.** The list step's wall time on this repository is measured in the pull request. The build branch is measured in the e2e and on a real flake build here, and the numbers are recorded in the PR body. The build branch exceeds a minute only when a released package changes without a release, and that exception is documented in the body with its measurement.
- **KTD6. Intents.**
  - `@systemfsoftware/github-release-engine: minor`, for the new cell and the extracted function.
  - `@systemfsoftware/github-release-management: minor`, for the `digests` command.
  - `@systemfsoftware/release-language`, only if a new refusal type is added.

### Test admission

- **AE1 and AE2: admitted.** They are e2e phases through the real reusable workflow, the real CLI and a real annotated release tag. They reproduce the defect class (a wrong `none` that `plan` would refuse after merge) at the observable boundary.
- **AE3: admitted.** It is an integration feature over the published cell, with the real tarball reader. A `FakeGit` fixture already exists in `github-release-engine` tests for remote tags and annotations.
- **AE4: one-time real-tool verification, not committed.**

### Assumptions challenged (destructive review)

1. _"The gate's evidence finds every package whose tarball changed."_ Under `turbo` the evidence is the build task's hash, which covers global inputs and dependencies. Under `paths`, a root-level or lockfile-only change can alter a tarball without touching the package's directory. Such a package escapes this check and `plan` still refuses it after merge. The scope is Turbo's affected set by design (`pr-gate-runs-only-what-the-diff-affects`); widening it to every released package would build tarballs on every pull request.
2. _"Two flake builds of the same tree give the same tarball."_ The Sandbox lane's "tarballs rebuild bit-for-bit" job runs `nix build --rebuild .#workspace-tarballs` on every pull request, and its pass is the evidence.
3. _"The job can read remote tags and their annotations."_ `actions/checkout` with `fetch-depth: 0` persists a `contents: read` token, which is enough for `git ls-remote` and fetching a tag object from `origin`. AE1 exercises it against a real remote.
4. _"A dependent that changesets bumps changes bytes but is exempt."_ That is correct: it releases, so its tarball is new by definition. `projectPlan` already drops only `none` releases.
5. _"Every caller has `.#workspace-tarballs`."_ `release.yml` already requires it, and tags with recorded integrity exist only where `release.yml` ran. A caller without it has no such tags, so the at-risk set is empty and the build never runs.

### Implementation Units

#### U1. e2e phase, red on `main`

- **Files:** `e2e/tests/pipeline.integration.test.ts`.
- A wrong-`none` phase after "plan is empty once tags exist": commit a change to `@e2e/alpha` with a `none` intent, pack the stubbed workspace tarballs, run the `require-intent` job, and expect a non-zero step whose output names `@e2e/alpha@v1.1.0`. Then restore the fixture.
- **Verification:** red on `main` in CI's E2E job, because the job passes.

#### U2. Extract `plan`'s per-member integrity resolution (KTD1)

- **Files:** `packages/github-release-engine/src/integrity.ts` and `plan.ts`. `plan`'s existing tests stay green unchanged.

#### U3. `digestsCell` and its feature (KTD2, AE3)

#### U4. `digests` command (KTD3)

#### U5. Workflow steps (KTD4)

The e2e step-list assertion gains the new steps (AE2).

#### U6. Intents (KTD6), README command table, CONCEPTS vocabulary if a term is added

### Verification Contract

| Row                              | Command                                                                       | Proves            |
| -------------------------------- | ----------------------------------------------------------------------------- | ----------------- |
| e2e red/green                    | CI E2E on U1 alone, then on the full branch                                   | AE1               |
| No build when nothing is at risk | the e2e step list, plus this pull request's own Changeset job log             | AE2, R3           |
| Engine                           | `pnpm --filter @systemfsoftware/github-release-engine test`                   | AE3               |
| Real repository                  | the Nix-built tools plus `nix build .#workspace-tarballs` on a scratch branch | AE4               |
| Wall time                        | Changeset job time from the jobs API, before and after                        | KTD5              |
| Workflow lint                    | `actionlint` on `changeset-check.yml`                                         | workflow validity |

Mutation testing is not run locally.
