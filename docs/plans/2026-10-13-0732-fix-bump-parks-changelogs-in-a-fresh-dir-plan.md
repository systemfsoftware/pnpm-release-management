---
title: Bump parks member changelogs in a changelog directory that does not exist yet - Plan
type: fix
date: 2026-10-13
topic: bump-parks-changelogs-in-a-fresh-dir
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
execution: code
---

# Bump parks member changelogs in a changelog directory that does not exist yet - Plan

## Goal Capsule

- **Objective:** Every push to `main` gets a green Release (dogfood) run again, and `version-management bump` can park member changelogs on a fresh checkout of any repository.
- **Means:** `bump` creates the directory it parks member changelogs in, and the fixtures stop creating that directory for it.
- **Product authority:** the repository's root. The fix is forward-only, in one pull request off `main`; root merges it and confirms the lane on `main`.
- **Open blockers:** none.

## Product Contract

### Summary

`version-management bump` refuses with `ChangelogUnwritable ... NotFound` whenever a moved member's changelog is parked under `changelogDir` and that directory is absent, which is its state in every fresh checkout. Bump will create the directory before parking the file. The CLI-level e2e suite and the in-process bump integration test both pin this, on fixtures that no longer pre-create the directory.

### Problem Frame

The Release (dogfood) lane has failed on every push to `main` since `2915f4e` (2026-10-07), the last green run. That run was green only because `.changeset/` held no intents, so the plan settled to phase `none` and bump never ran. The failures since then have several causes, each masked by the next:

- **`e0f93b9`, `98e90e6`:** the first intent named only `none` bumps, so bump wrote no member changelog and passed. The release PR step then failed on missing authentication, later fixed in `#40`.
- **`8a89745`:** the first intent that moved a member. Bump failed with `ChangelogUnwritable: path=.changeset/changelogs/@systemfsoftware!changeset-management@0.1.0.md reason=NotFound`.
- **`ca932ae` through `524505a`:** the plan derived phase `release` or failed earlier, so bump did not run. Those runs failed on other steps (tag capture, missing parked changelogs, help output).
- **`a054e46` through `2b89555`:** bump runs on every push and fails with the same `ChangelogUnwritable ... NotFound` for `changeset-management@1.0.0`.

No commit in `2915f4e..21fe619` introduced the defect. The parked write has never created its directory: before `8f0eeea` it wrote `${changelogDir}/<name>@<version>.md` through the same `overwriteTextFile`, and `8f0eeea` only moved the path into the entry. The lane exposes the defect because this repository's `changelogDir`, `.changeset/changelogs`, holds no tracked file, so git never materialises it, and `pnpm-workspace.yaml` declares no storage, so the default `registry` parks there.

The tests never saw it because every fixture creates the directory first. `e2e/fixture.ts` runs `mkdir -p .changeset/changelogs`, and the changesets integration test seeds `.changeset/changelogs/.gitkeep`. Both are preconditions a real repository does not meet.

Reproduced on a clone of `main` with the release tools built from `main` (`nix build .#release-tools`): `version-management bump` prints the exact CI line and exits 1. On the same clone with only `.changeset/changelogs/` created, it exits 0 and parks one file per moved member. The scoped names flatten to `@scope!name@version.md`, so no nested scope directory is involved.

### Requirements

**Parking**

- R1. Under `registry` storage, `bump` parks each moved member's changelog even when `changelogDir`, or any parent of it inside the repository, does not exist yet.
- R2. When the directory cannot be created or the file cannot be written, `bump` still refuses with `ChangelogUnwritable: path=<parked path> reason=...`. A parked file never lands anywhere other than `changelogDir`.

**Proof**

- R3. The public `version-management bump` CLI, driven on a real git repository that has a pending intent moving a member and no `changelogDir`, exits 0 and parks the member's changelog. It fails on `2b89555` and passes with the fix.
- R4. The fixtures that pin bump's parked write, `e2e/fixture.ts` and `packages/version-engine/tests/changesets.integration.test.ts`, do not pre-create `changelogDir`, because doing so hides R1. The `.gitkeep` seeds in the release-step and storage-switch fixtures stay: they model a tree bump has already written.

**Lane**

- R5. The fix changes no workflow file. The workflow creating the directory would be wrong: the README's configuration table makes `changelogDir` bump's output location, and every consumer's checkout lacks it equally.

### Acceptance Examples

- AE1. **Covers R1, R3.** A repository with members `@e2e/alpha` and `@e2e/beta`, intents that move both, and no `.changeset/changelogs/` runs `version-management bump`. It exits 0, `.changeset/changelogs/@e2e!alpha@1.1.0.md` holds alpha's intent summary, and the intent files are consumed.
- AE2. **Covers R2.** The same repository with `.changeset/changelogs` present as a regular file still exits 1 with a `ChangelogUnwritable: path=.changeset/changelogs/@e2e!alpha@1.1.0.md` line.
- AE3. **Covers R1.** Under `repository` storage the member's own `CHANGELOG.md` is written as before. The member directory always exists, so behaviour is unchanged.

### Key Decisions

- **The fix is in bump's changelog store, not the workflow.** The README names `changelogDir` as where bump parks changelogs, so bump owns creating it. A workflow-side `mkdir` would leave every consumer's first registry-storage bump broken. Governs R1, R5.
- **The regression proof drives the CLI, and no new test file is added.** The defect hid behind fixtures that pre-created the directory. Removing that precondition turns the existing e2e version phase, which drives the real CLI, and the in-process bump integration test into failing tests on `main`. Governs R3, R4.
- **The `e2e.yml` per-SHA main concurrency correction is out of scope.** `ci.yml` and `sandbox.yml` share the pattern, and full compliance also moves the heavy E2E suite off pull requests. That is a separate CI change, not a fix to the Release lane.

### Scope Boundaries

- Deferred: per-commit concurrency for main pushes in `e2e.yml`, `ci.yml` and `sandbox.yml`, and moving the full-stack E2E suite postsubmit (pack: ci-wall-clock, heavy-suites-judge-every-main-commit.md).
- Deferred: the stale comment at the top of `release.jsonc`. It says every member is private and the plan settles to `none`, but the 13 `packages/*` members are public, so the plan now reaches `version`.
- Deferred: a root changelog declared under a directory that does not exist. `appendReleaseSummary` writes it with the same no-mkdir write, but that directory is the consumer's, and this lane's root changelog is `CHANGELOG.md` at the root.
- Outside this change: the release PR, tag and GitHub Release steps. They run after bump and were fixed separately (`#37` to `#49`). They have not run on `main` since those fixes, so the first green run after merge is their first live run.

### Dependencies / Assumptions

- Once bump passes, the next step on `main` opens or updates the `changeset-release/main` pull request from the pending intents. That pull request is the lane's designed output. It is never merged automatically.

### Sources / Research

- Failing step: `.github/workflows/release.yml` job `version`, step `Bump every package and version surface, consuming the intents`.
- Writer: `packages/workspace-adapter/src/ChangelogStoreLive.ts` (`writeMemberChangelog`) and `packages/workspace-adapter/src/StoreFile.ts` (`overwriteTextFile`).
- Path rule: `memberChangelogPathOf` in `packages/release-language/src/MemberChangelog.ts`. Configuration contract: `README.md` table row `changelogDir`.
- Fixtures that hid the defect: `e2e/fixture.ts:66`, and `packages/version-engine/tests/changesets.integration.test.ts`, which seeds `.gitkeep` in three scenarios.
- Effect's `FileSystem.writeFileString` never creates parent directories. `makeDirectory(dir, { recursive: true })` succeeds when the directory exists and fails when a file holds that path.

## Planning Contract

### Key Technical Decisions

- KTD1. **`writeMemberChangelog` creates the parent directory of `entry.path` before writing, for both storages.** Under `repository` storage the parent is the member directory, which always exists, so the call is a no-op there and the writer keeps one shape. Governs R1, AE3.
- KTD2. **The directory is created through a `StoreFile` helper that maps a platform error to a `StoreFault`, like every other file operation there.** The store maps that fault to `ChangelogUnwritable { path, reason }` for the parked path, so the refusal line keeps its shape. Governs R2.
- KTD3. **`overwriteTextFile` keeps refusing a missing parent.** Manifests and surfaces are written to paths the repository already holds, where a missing directory means misconfiguration. Only the parked changelog needs the directory created. Governs R1.

### Change intent

`@systemfsoftware/workspace-adapter: patch`. The adapter's API is unchanged; bump now succeeds where it refused.

## Implementation Units

### U1. Remove the precondition that hid the defect

- **Goal:** the existing tests reproduce the defect on `main`.
- **Requirements:** R3, R4; AE1.
- **Files:** `e2e/fixture.ts`, `packages/version-engine/tests/changesets.integration.test.ts`.
- **Approach:** delete the `mkdir -p ${FIXTURE}/.changeset/changelogs` line from the e2e fixture, and the three `['.changeset/changelogs/.gitkeep', '']` seed rows from the integration test. Nothing else in either file changes.
- **Test scenarios:** the integration scenario "A release plan moves two members and writes a changelog each" fails locally on `main` with `ChangelogUnwritable ... NotFound`. The e2e phase "version step bumps surfaces, writes changelogs, consumes intents" fails in CI on this commit alone.
- **Verification:** the local run fails with the same line as CI; the pull request's E2E job is red on this commit.

### U2. Bump creates the changelog directory

- **Goal:** R1 and R2.
- **Requirements:** R1, R2, R5; AE1, AE2, AE3.
- **Dependencies:** U1.
- **Files:** `packages/workspace-adapter/src/StoreFile.ts`, `packages/workspace-adapter/src/ChangelogStoreLive.ts`, `.changeset/<slug>.md`.
- **Approach:** add a `StoreFile` helper that runs `fs.makeDirectory(dir, { recursive: true })` and maps errors through `faultOf`. Call it in `writeMemberChangelog` on `path.dirname` of the full path before `overwriteTextFile`, mapping its fault to `ChangelogUnwritable` for the parked path (KTD1, KTD2).
- **Test scenarios:** U1's integration scenario and e2e phase pass.
- **Verification:** the integration suite passes locally; the CLI from `nix build .#release-tools` exits 0 on a clone of `main` without the directory; the same CLI exits 1 with a `ChangelogUnwritable` line when `.changeset/changelogs` is a regular file (AE2).

## Verification Contract

| Row          | Command                                                                                                                | Proves                                              |
| ------------ | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Red before   | `pnpm --filter @systemfsoftware/version-engine exec vitest run tests/changesets.integration.test.ts` after U1 only     | the in-process bump reproduces the CI line (R3, R4) |
| Green after  | the same command after U2                                                                                              | R1                                                  |
| Real CLI     | `nix build .#release-tools`, then `version-management bump` on a fresh clone of `main` with no `.changeset/changelogs` | AE1 through the shipped CLI                         |
| Refusal kept | the same CLI with `.changeset/changelogs` created as a file                                                            | AE2, R2                                             |
| Static gates | `pnpm check:ci` minus the container e2e (`pnpm typecheck`, `pnpm lint`, `pnpm format:check`, package tests)            | no regression                                       |
| CI           | the pull request's E2E job red on U1's commit, green on U2's                                                           | R3 through the CLI in the container                 |
| Lane         | root observes the first Release (dogfood) run on `main` after merge, green or the named failing step                   | the Objective                                       |

Mutation testing is not run locally; mutation evidence comes from main-branch CI. No workflow file changes, so no `actionlint` row.

## Definition of Done

- U1 and U2 landed as separate commits, the E2E job observed red on U1 and green on U2.
- Every Verification Contract row executed and recorded in the pull request, except the Lane row, which root records after merge.
- No workflow file, timeout or skip changed.
