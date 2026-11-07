---
title: The changeset check compares an unreleased package's flake-built tarball with its release tag - Plan
type: feat
date: 2026-10-13
topic: pr-time-tag-digest-check
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
execution: code
supersedes: docs/plans/2026-10-13-2019-feat-pr-time-tag-digest-check-plan.md
---

# The changeset check compares an unreleased package's flake-built tarball with its release tag - Plan

## Goal Capsule

- **Objective:** a pull request that changes a released package's tarball without releasing it is refused before merge, by the same comparison `github-release-management plan` makes after merge.
- **Means:** the reusable changeset check asks the release tools which affected packages will release nothing. Only when that set is non-empty does it build the caller's `.#workspace-tarballs` and compare each one with the integrity its release records.
- **Product authority:** the repository's root. `plan`'s integrity rules are unchanged, and no remote tag is created, moved or rewritten.

## Product Contract

### Problem Frame

`changeset-management check` accepts a changed publishable package once any intent names it, `none` included. `plan` runs after merge, on `main`, and only there compares an unreleased package's tarball with the integrity its release records (`TagIntegrityMismatch`). So a wrong `none` passes review and turns the Release run on `main` red.

### Requirements

- **R1.** At pull-request time, every package that meets all four conditions is checked:
  - the diff's change evidence names it as touched (Turbo's under `"strategy": "turbo"`, directory classification under `"paths"`);
  - it is publishable;
  - a remote release tag exists at its current version;
  - the pending intents give it no release, because its rows are all `none` or no intent names it.

  The intent gate runs first and already refuses a touched publishable package that no intent names, so in practice the set is the touched packages whose rows are all `none`.
- **R2.** Each such package's tarball from the caller's flake (`nix build .#workspace-tarballs`, the derivation `release.yml` tags from) must match what its release records: the ledger's `published` state when the ledger has an entry, otherwise the tag annotation. The rules are exactly `plan`'s:
  - a lightweight tag is refused;
  - a burned version is refused;
  - a moved ledger tag is refused;
  - a differing tarball is refused.
- **R3.** When no package meets R1, no tarball is built: the job adds one evidence pass and no Nix build. When the set is non-empty and the caller's flake has no `workspace-tarballs` output, the job fails with one named line telling the caller to add that output.
- **R4.** The mismatch refusal is the single line `tag digests refused: <package>@v<version> ...`. It names:
  - the package and its tag;
  - the recorded and the built integrity;
  - the first differing file;
  - the fix: give the package a real bump, or revert its change.

  The `digests` command renders it. `plan`'s own renders are unchanged. The other integrity refusals (lightweight, burned, moved ledger tag) keep `plan`'s lines.
- **R5.** `plan`'s behaviour is unchanged.

### Acceptance Examples

- **AE1 (wrong none, real release).** In the container e2e, after the fixture's 1.1.0 release is tagged with recorded integrity, a change to `@e2e/alpha` carries an intent with `"@e2e/alpha": none`. The changeset check job builds the stubbed `.#workspace-tarballs` from the changed tree and fails with the refusal naming `@e2e/alpha@v1.1.0`. Before this change the same job passes. Covers R1, R2, R4.
- **AE2 (nothing at risk, no build).** In the existing e2e changeset-check phase, the intent gives `@e2e/alpha` a minor bump. The job's step list gains the digests list step and contains no digests verify step: the harness omits a step whose `if:` is false. Covers R3.
- **AE3 (engine).** An integration feature over the published cell covers three cases:
  - a `none` row for a touched package whose tarball matches the annotation passes (a touched package whose packed files did not change);
  - a `none` row whose tarball differs is refused with `TagIntegrityMismatch`;
  - a package with a non-`none` planned release is not checked.

  It uses the real tarball reader on real `.tgz` files. Covers R1, R2.
- **AE4 (real repository).** The Nix-built tools run in a scratch clone of this repository. The branch changes `@systemfsoftware/adoption-adapter` under a `none` intent; its annotated `v0.0.0` tag records integrity, so the verdict is a comparison, not an annotation refusal. The clone's flake-built tarballs give `TagIntegrityMismatch`, and an unchanged tree passes. Covers R2.

### Scope Boundaries

- No behavioural change to `plan`. Its per-member integrity resolution moves to the shared function in U2, and the ledger, tags, `release.yml` and `tag` are unchanged.
- The 11 lightweight `v0.0.0` tags stay as they are. A pull request that changes such a package and leaves it unreleased is refused (`TagAnnotationLightweight`), as `plan` would refuse it after merge.
- Under `"strategy": "paths"`, a root-level or lockfile-only change can alter a released package's tarball without the evidence naming it. That package is not checked here, and `plan` still refuses it after merge. The check is scoped to the evidence by design (`pr-gate-runs-only-what-the-diff-affects`): checking every released package would build tarballs on every pull request.

## Planning Contract

### Key Technical Decisions

- **KTD1. The comparison is `plan`'s, extracted once.** The per-member resolution in `plan.ts` (ledger state, ledger tag commit, annotation parse, digest lookup) moves into one exported function in `github-release-engine`. `plan` and the new cell both call it, and `verifyIntegrity` decides. There is no second copy.
- **KTD2. A new `unreleasedTarballsCell` in `github-release-engine`, with two modes.**
  - Without tarballs, it returns the at-risk names, so the workflow can decide whether to build.
  - With tarballs, it returns the verdict.
  - Its ports: `ChangeEvidencePort`, `WorkspaceStore`, `ChangesetsPort`, `GitPort`, `LedgerPort`, `TarballPort`.
  - `github-release-management` already wires `GitPort`, `LedgerPort` and `WorkspaceStore`, plus `ChangesetsPort` and `TarballPort` per command. The `digests` command adds `ChangeEvidenceLive` with `RegistryLive` over `FetchHttpClient`, as `changeset-management` composes it.
  - No new refusal type: the refusal is `plan`'s existing `IntegrityRefusal` union. The command carries its state as one tagged `targets` union (none at risk, awaiting tarballs, compared, refused), so the workflow matches it and probes no field.
- **KTD3. CLI:** `github-release-management digests <base> [--tarballs <dir>] [--output <file>]`. Both modes write one `packages=<names, space-separated>` line, to stdout or appended to `--output`, which the workflow points at `$GITHUB_OUTPUT`. The verify mode first prints `tag digests: N package(s) match their release tags` or fails with the R4 line.
- **KTD4. Workflow.** `changeset-check.yml` gains two steps after the intent verdict, so the first verdict step stays where it is:
  1. **The digests list step:** `id: digests`, which writes `packages` to `$GITHUB_OUTPUT`.
  2. **The digests verify step:** `if: steps.digests.outputs.packages != ''`. It runs `nix build --no-link --print-out-paths .#workspace-tarballs`, or fails with R3's named line when the output is missing, then runs the verify mode.

  There is no dev shell, and the release tools run as built (`no-dev-shell-on-verdict-lanes`, `light-checks-run-the-pinned-tool`). The evidence scopes the work (`pr-gate-runs-only-what-the-diff-affects`). The build comes after the first verdict step and runs only when the diff changes a released package's inputs, one of the two cases `setup-under-a-minute` allows.

  The comparison lives in the reusable changeset check, not in this repository's Sandbox lane, which already builds the same derivation. Consumers run the reusable check, while `sandbox.yml` is this repository's own workflow, and the at-risk set comes from the evidence that check already computes.
- **KTD5. Measured cost.** The list step's wall time is measured on this pull request's own Changeset job. The verify step is measured in the e2e and on a real flake build here. The numbers go in the PR body; the build is the documented exception, paid only when a released package changes without a release.
- **KTD6. Intents.**
  - `@systemfsoftware/github-release-engine: minor`, for the new cell and the extracted function.
  - `@systemfsoftware/github-release-management: minor`, for the `digests` command.
  - `@systemfsoftware/process-adapter: minor` and `@systemfsoftware/release-language: minor`, for the shared evidence refusal lines, `evidenceOf`, `taskOf` and the `ChangeEvidenceRefusal` schema that the simplify pass moved out of both apps and both cells.

### Test admission

- **AE1 and AE2: admitted.** They are e2e phases through the real reusable workflow, the real CLI and a real annotated release tag. They reproduce the defect class (a wrong `none` that `plan` refuses after merge) at the observable boundary.
- **AE3: admitted.** It is an integration feature over the published cell with real adapters only: a real pnpm workspace and intent file, `paths` change evidence over real git, the real tarball reader and ledger, and an annotated tag pushed to a bare remote.
- **AE4: one-time real-tool verification, not committed.**

### Assumptions challenged (destructive review)

1. _"The evidence finds every package whose tarball changed."_ Not under `paths`; see Scope Boundaries.
2. _"An unchanged member's tarball is byte-identical when built from a different tree."_ This is `plan`'s own premise.
   - Measured on `main` `ef8970e`: the flake-built `adoption-adapter-0.0.0.tgz` has exactly the sha512 its annotated tag recorded at `524505a`, although 24 files changed across the tree in between.
   - The Sandbox lane separately proves same-tree determinism (`nix build --rebuild`) on every pull request.
3. _"The job can read remote tags and their annotations."_ `actions/checkout` with `fetch-depth: 0` persists a `contents: read` token, which is enough to list remote tags and fetch tag objects from `origin`. AE1 exercises this against a real remote.
4. _"A dependent that changesets bumps changes bytes."_ It releases, so it is not checked. `projectPlan` drops only `none` releases.
5. _"Every caller has `.#workspace-tarballs`."_ Not guaranteed: tags can predate `release.yml` (adopted or lightweight), and R1 keys on the tag name alone. R3's named line covers a caller that lacks the output.

### Implementation Units

#### U1. e2e phase, red on `main` (AE1)

- **Files:** `e2e/tests/pipeline.integration.test.ts`.
- After "plan is empty once tags exist": commit a change to `@e2e/alpha` with a `none` intent, run the `require-intent` job, and expect a failing step whose output names `@e2e/alpha@v1.1.0`. Then restore the fixture.
- **Verification:** red on `main` in CI's E2E job, because the job passes.

#### U2. Extract `plan`'s per-member integrity resolution (KTD1)

- **Files:** new `packages/github-release-engine/src/released-tarballs.ts` (the per-member resolution, `unreleasedOf` and `ledgerEntries`), called from `plan.ts`. `plan`'s existing tests stay green unchanged.

#### U3. `unreleasedTarballsCell` and its feature (KTD2, AE3)

#### U4. `digests` command and its R4 render (KTD3)

#### U5. Workflow steps (KTD4), plus AE2's step-list assertion

#### U6. Intents (KTD6), README command table, CONCEPTS vocabulary if a term is added

### Verification Contract

| Row                              | Command                                                                      | Proves            |
| -------------------------------- | ---------------------------------------------------------------------------- | ----------------- |
| e2e red/green                    | CI E2E on U1 alone, then on the full branch                                  | AE1               |
| No build when nothing is at risk | the e2e step list, plus this pull request's own Changeset job log            | AE2, R3           |
| Engine                           | `pnpm --filter @systemfsoftware/github-release-engine test`                  | AE3               |
| Real repository                  | the Nix-built tools plus `nix build .#workspace-tarballs` in a scratch clone | AE4               |
| Wall time                        | Changeset job steps from the jobs API, before and after                      | KTD5              |
| Workflow lint                    | `actionlint` on `changeset-check.yml`                                        | workflow validity |

Mutation testing is not run locally.
