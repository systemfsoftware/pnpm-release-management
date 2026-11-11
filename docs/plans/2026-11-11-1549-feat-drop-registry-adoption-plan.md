---
title: Drop registry adoption and the tag-integrity check - Plan
type: feat
date: 2026-11-11
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
execution: code
---

# Drop registry adoption and the tag-integrity check - Plan

## Goal Capsule

- **Objective:** A release whose version is already tagged is skipped, never refused. Repackaging the same source (for example after a catalog bump rewrites a packed `package.json`) no longer turns a release red.
- **Means:** Delete the npm-registry adoption path and the tarball integrity comparison, with their schemas, ports, adapters, refusals, flags and tests; keep the changeset-driven version and tag decisions (KTD1).
- **Authority:** The owner directive (KISS, delete rather than patch) overrides everything below except `AGENTS.md`. Existing contracts that survive: `legacyTags`, the changeset gate, the version bump, captured cycles, GitHub Releases.
- **Stop conditions:** Stop and report if a deleted symbol turns out to carry a consumer-visible behavior outside the release (KTD2 is the one found so far).
- **Execution profile:** One pull request, marked ready only when every unit is done. Affected-package typecheck and tests only, one command at a time; no full-tree run, no mutants, no local container e2e.

---

## Product Contract

### Summary

`release plan` and `release tag` stop reading tarballs. `release adopt` and the adoption ledger go away. The release workflow stops packing the workspace. A tagged version is skipped by tag presence alone.

### Problem Frame

The release fetches each tagged version's identity from an npm-style registry and refuses `tag-integrity-mismatch` when the freshly packed tarball differs from the recorded bytes. Packages now ship only through nix.systemfsoftware.com, which is content-addressed, and consumers pin producer commits, so the check guards nothing. It blocks every release whenever a catalog bump rewrites a packed `package.json`. systemfsoftware core's Release has been red since 2026-11-11 02:35Z, refused for `@systemfsoftware/stryker-config@0.2.1` (file `package/package.json`), although the package's source equals its tag.

### Requirements

**Release behavior**

- R1. `release plan` derives the phase from pending changesets, remote tags and `legacyTags` alone. It reads no tarball, ledger or registry.
- R2. A member whose `<name>@v<version>` tag exists on the remote, or whose legacy tag verifies, counts as released: `plan` does not owe it, `tag` does not create or push it, and nothing republishes it.
- R3. `release tag` still captures the cycle and pushes one annotated tag per owed package, idempotently, from the commit it releases.

**Deleted surface**

- R4. `release adopt`, `--registry`, and `--tarballs` on `plan` and `tag` no longer exist.
- R5. The refusals `tag-integrity-mismatch`, `integrity-nothing-to-verify`, `integrity-files-empty`, `tag-annotation-malformed`, `tag-annotation-lightweight`, `tarball-missing`, `tarball-unreadable`, `ledger-*`, `version-burned` and adoption failures no longer exist.
- R6. `changeset check` no longer reads or verifies the adoption ledger. Its other checks, and its turbo-pin fetch, behave as before.
- R7. `.github/workflows/release.yml` no longer builds `.#workspace-tarballs` or passes `--tarballs`. The workflow declares no registry or adoption input (it declares none today; the deletion is the pack steps and flags).
- R8. The packages `adoption-adapter` and `tarball-adapter` no longer exist.

**Documentation and versioning**

- R9. Docs describe only what remains. A changeset intent names every touched publishable package with the bump the removed surface implies.

### Scope Boundaries

Not built, considered:

- A replacement guard that detects changed bytes under a released version. Content-addressing and commit pins already carry it; evidence that a consumer re-pins a producer by version would change the call.
- Cleanup of existing annotated tags or a consumer's `release-ledger.json`. Nothing reads them afterwards; a consumer deletes the file at its own pace.
- Reverting `updateInternalDependents: 'always'` in `packages/changesets-adapter/src/ChangesetsPortLive.ts`. It was added to keep integrity holding, but it decides released versions, so it stays.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **Delete outright, no shims.** Every definition, call site, export, test, doc and fixture of the removed behavior goes in this PR (AGENTS.md DEL1). Governs R4, R5, R8.
- KTD2. **Keep the turbo binary download; drop `RegistryPort`.** `process-adapter`'s `turbo-fetch.ts` downloads the lockfile-pinned `@turbo/<os>-<arch>` tarball through `RegistryPort.download`. That is change evidence, not release adoption, and `changeset check` depends on it. `RegistryPort`, its schemas and `RegistryLive` die with the adoption adapter. `turbo-fetch.ts` takes `HttpClient` directly and keeps every refusal text, including `registry has no tarball at <url>` for a 404. Governs R6. Considered: keeping `adoption-adapter` reduced to `RegistryLive.download`; rejected because the package would be named for the purpose being deleted.
- KTD3. **Tags stay annotated; the message is the tag name.** The message used to carry the integrity JSON. Lightweight tags would change the tag object kind and drop the bot-identity behavior in the `tag-bot-identity` changeset; every tag consumers hold is annotated. `TagCommand` loses `annotations`; `pushTags` writes the tag with its own name as message. `GitPort.tagAnnotation` and `GitLive.annotationOf` go. `writeTag`, `tagCommit` and `tagTree` stay (`tag.ts`, `legacy.ts` use them). Governs R3.
- KTD4. **`tarball-adapter` is deleted; its tar parser moves.** `TarballLive` and `TarballPort` only fed the integrity check. `parseTar` (`packages/tarball-adapter/src/tar.ts`) has one consumer, `process-adapter`, which takes it as `src/tar.ts`. Governs R8.
- KTD5. **The legacy-release plan note drops "identity not recorded".** There is no recorded identity anywhere afterwards. New text: `plan-release: legacy release <tag> (<name>@<version>)`. Governs R2.
- KTD6. **Bumps follow the removed surface.** Removing exports or narrowing a port is `major` (pack: package-topology, surface-changes-are-versioned.md). Packages that only rebuild because a dependency changed take `none`. The pending changesets `adoption-ledger.md` and `tarball-identity.md` announce features this PR removes and name the deleted packages, so they are deleted; `changeset-check-fetches-pinned-turbo.md` and `legacy-release-tags.md` keep their entries but lose the sentences about `RegistryPort`/`RegistryLive` and "identity not recorded". Governs R9.

### System-Wide Impact

- Consumers of the reusable `release.yml` stop needing a `workspace-tarballs` flake output for the release. `nix-cache-push.yml` and `sandbox.yml` still build it for distribution and stay unchanged.
- A consumer picks this up by moving two pins: the flake input and the `uses: ...release.yml@<sha>` line. Tools build at the workflow's own `job.workflow_sha`, so the `uses:` pin is what makes its Release green.
- The e2e verdaccio tripwire (`the release never publishes to npm`) is unrelated to adoption and stays.

---

## Implementation Units

One PR; units are dependency-ordered.

### U1. Remove the registry, ledger, integrity and tarball vocabulary

**Goal:** `release-language` and `git-adapter` hold none of the deleted concepts.

**Requirements:** R5, R8; KTD1, KTD3.

**Files:**

- Delete: `packages/release-language/src/{Ledger.schema.ts,LedgerPort.ts,Registry.schema.ts,RegistryPort.ts,Integrity.schema.ts,TarballPort.ts}`
- Modify: `packages/release-language/src/index.ts` (drop every export of the above, including `LEDGER_PATH`, `VersionBurned`, `VersionState`, `TarballIntegrity`)
- Modify: `packages/release-language/src/GitPort.ts` (drop `tagAnnotation`)
- Modify: `packages/git-adapter/src/GitLive.ts` (drop `tagAnnotation`, `annotationOf`)
- Modify: `packages/git-hooks-engine/tests/__fixtures__/FakeGitPort.ts`, `packages/process-adapter/tests/__fixtures__/FakeGitPort.ts` (drop `tagAnnotation`)

**Approach:**

1. Delete the six files and their re-exports.
2. Remove `tagAnnotation` from the port, the live adapter and both fakes.
3. Leave `HttpUrl`, `FsPath`, `TaggedTree`, `TaggedManifest`: `process-adapter` and `legacy.ts` use them.

**Test scenarios:** Test expectation: none -- pure deletion; the typechecks of U2 to U6 prove that nothing still reaches these symbols.

**Verification:** `release-language`, `git-adapter` and `git-hooks-engine` typecheck.

### U2. Simplify plan and tag in the release engine

**Goal:** `planCell` and `tagCell` decide from tags and changesets only.

**Requirements:** R1, R2, R3, R5; KTD1, KTD3.

**Dependencies:** U1.

**Files:**

- Delete: `packages/github-release-engine/src/{adopt.ts,adopt-release.workflow.ts,adopt.schema.ts,integrity.ts,integrity.schema.ts}`
- Modify: `packages/github-release-engine/src/plan.ts` (drop `tarballs` from `PlanRequest`, the digest and ledger loop, `parseAnnotation`, `ChangesetsPort` and the `planned` read; keep `legacyReleased`, `cycleOf`, `dropExcluded`)
- Modify: `packages/github-release-engine/src/tag.ts` (drop `tarballs`, `annotationsOf`, ledger and burned checks; `pushTags` writes each tag with its own name as message)
- Modify: `packages/github-release-engine/src/tag-packages.workflow.ts` (drop `TagAnnotation` and `TagCommand.annotations`)
- Modify: `packages/github-release-engine/src/index.ts`, `packages/github-release-engine/package.json` (drop deps only the deleted files used)
- Delete: `packages/github-release-engine/src/__tests__/adopt-release.workflow.property.test.ts`, `packages/github-release-engine/tests/__fixtures__/{FakeLedger.ts,FakeTarball.ts}`
- Modify: `packages/github-release-engine/tests/__fixtures__/FakeGit.ts` (drop annotation state), `packages/github-release-engine/tests/release.integration.test.ts`, `packages/github-release-engine/tests/release-tag.integration.test.ts`, `packages/github-release-engine/src/__tests__/tag-packages.workflow.property.test.ts`
- Delete if unused afterwards: `packages/github-release-engine/tests/__fixtures__/FakeChangesetsPort.ts`

**Approach:**

1. `plan.ts` after the change reads intents, members, remote tags, legacy releases, deferred names, changelog storage, and builds `PlanCommand` as before. Its requirement set is `ChangesetStore | WorkspaceStore | GitPort | CycleStore`.
2. `tag.ts` keeps `readExclusion`, `readCycle`, `captureCycle`, `requireTaggedAt`, `pushTags`; its requirement set is `WorkspaceStore | GitPort | CycleStore`.
3. In `release.integration.test.ts`, delete the integrity scenarios (annotation matches, differs, empty files, zero checks, tarball missing) and every `makeFakeTarball`, `makeFakeLedger` and `makeFakeChangesetsPort` layer argument.

**Patterns to follow:** the existing Gherkin feature style in `release.integration.test.ts`.

**Test scenarios:**

- Plan, a tagged publishable member with no changesets pending: `phase=none`, no refusal. This is the live failure's regression case, with no tarball input to differ.
- Plan, a tagged member plus a pending intent: `phase=version`.
- Plan, an untagged member: `phase=release`, `this_cycle` counts it.
- Plan, a legacy-tagged member at or below `through`: skipped (existing scenarios stay).
- Tag, owed packages: pushed once; rerun over pushed tags stays idempotent (existing scenarios stay).
- Tag, real git (`release-tag.integration.test.ts`): the pushed tag is an annotated tag object whose message is the tag name.

**Verification:** `github-release-engine` typecheck and tests pass.

### U3. Remove the ledger from the changeset gate

**Goal:** `changeset check` no longer reads or verifies an adoption ledger.

**Requirements:** R5, R6; KTD1.

**Dependencies:** U1.

**Files:**

- Delete: `packages/changeset-engine/src/verify-ledger-append.workflow.ts`, `packages/changeset-engine/src/__tests__/verify-ledger-append.workflow.property.test.ts`, `packages/changeset-engine/tests/__fixtures__/FakeLedgerPort.ts`
- Modify: `packages/changeset-engine/src/gate-changes.ts` (drop the ledger reads, the append verdict, `LedgerRefusal`, `LedgerAppend*`, `LedgerPort` from the requirements), `packages/changeset-engine/src/index.ts`
- Modify: `packages/changeset-engine/src/__tests__/gate-changes.workflow.property.test.ts`, `packages/changeset-engine/tests/changeset.integration.test.ts` (drop `fakeLedgerPort()` layers)

**Test scenarios:** The existing gate scenarios (no touched package, touched and named, touched and unnamed, unknown package, deleted package) pass without a ledger layer. No new scenario: no behavior is added.

**Verification:** `changeset-engine` typecheck and tests pass.

### U4. Turbo fetch over `HttpClient`; tar parser moves

**Goal:** `process-adapter` stops depending on `RegistryPort` and `tarball-adapter` and still fetches the pinned turbo.

**Requirements:** R6, R8; KTD2, KTD4.

**Dependencies:** U1.

**Files:**

- Create: `packages/process-adapter/src/tar.ts` (the content of `packages/tarball-adapter/src/tar.ts`)
- Modify: `packages/process-adapter/src/turbo-fetch.ts`, `packages/process-adapter/src/turbo-evidence.ts`, `packages/process-adapter/src/ChangeEvidenceLive.ts` (requirement `GitPort | HttpClient`), `packages/process-adapter/package.json`
- Modify: `packages/process-adapter/tests/__fixtures__/served-turbo.ts` (serve through `FetchHttpClient.layer`), `packages/process-adapter/tests/paths-under-turbo.integration.test.ts`, `packages/process-adapter/tests/turbo-pin.integration.test.ts` (only if they name `registryServing`)

**Approach:**

1. In `turbo-fetch.ts` replace `registry.download(url)` with an `HttpClient` GET: network failure, 404, non-2xx and body read failure map to the same `reason` strings `RegistryLive.download` produced, so the `cannot fetch <key> from <url>: <reason>` refusals do not change.
2. Import `parseTar` from `./tar.js`.

**Test scenarios:** The existing `turbo-pin.integration.test.ts` scenarios stay and pass unchanged in their expected texts: served turbo verifies both sides; integrity mismatch; no recorded integrity before any fetch; 404 names the recorded URL (`registry has no tarball at ...`); wrong version.

**Verification:** `process-adapter` typecheck and tests pass.

### U5. Apps: drop `adopt`, `--tarballs`, ledger layers and refusal renderers

**Goal:** The two apps expose and render only what remains.

**Requirements:** R4, R5, R6; KTD1, KTD5.

**Dependencies:** U2, U3, U4.

**Files:**

- Modify: `apps/github-release-management/src/main.ts` (remove `adopt`, `--tarballs`, `TarballLive`, `LedgerLive`, `RegistryLive`, `ChangesetsPortLive` for plan), `src/boundary.ts` (remove `AdoptFlags`, `adoptRequestOf`, `tarballs`), `src/render.ts` (remove the integrity, tarball, ledger, `version-burned` and adoption renderers and their types; apply KTD5)
- Modify: `apps/github-release-management/package.json` (drop `adoption-adapter`, `tarball-adapter`, `changesets-adapter`)
- Modify: `apps/github-release-management/tests/legacy-tags.integration.test.ts` (drop `TarballLive`, `LedgerLive`, `ChangesetsPort`, `tarballs`; the annotation expectation becomes "annotated tag whose message is the tag name"; the plan note expectation follows KTD5)
- Modify: `apps/changeset-management/src/main.ts`, `src/boundary.ts`, `src/render.ts`, `package.json` (no `LedgerLive`, no `RegistryLive`; provide `FetchHttpClient.layer` beside `GitLive`; drop the ledger renderers)

**Test scenarios:**

- Legacy tag at or below `through`: plan prints the KTD5 note and tag reports `TagUpToDate`.
- A new version after a legacy-released one: tag pushes an annotated `<name>@v<version>` and leaves the legacy tag untouched.
- A legacy tag whose commit declares another version: still refused `legacy-tag-unverified`.

**Verification:** `github-release-management` and `changeset-management` typecheck and tests pass.

### U6. Delete the two packages and fix the lockfile

**Goal:** The workspace has no `adoption-adapter` or `tarball-adapter`.

**Requirements:** R8; KTD1, KTD4.

**Dependencies:** U2 to U5.

**Files:**

- Delete: `packages/adoption-adapter/` and `packages/tarball-adapter/` entirely (sources, tests, configs, package.json)
- Modify: `pnpm-lock.yaml` (importers and `link:` entries of both packages, plus the dependency lines U2 to U5 removed)

**Approach:** Regenerate the lockfile with pnpm from the dev shell rather than hand-editing, then review that the diff only removes importers and links. If regeneration needs registry access that the host lacks, hand-edit exactly those entries.

**Test scenarios:** Test expectation: none -- deletion; `pnpm install --frozen-lockfile` and the typechecks of the remaining packages prove consistency.

**Verification:** `git grep -nI -e 'adoption-adapter' -e 'tarball-adapter' -- . ':!docs/plans' ':!docs/solutions'` returns exit 1 (DEL1).

### U7. Workflow, e2e, docs and changeset

**Goal:** Everything outside code describes and exercises the remaining release.

**Requirements:** R4, R7, R9; KTD6.

**Dependencies:** U6.

**Files:**

- Modify: `.github/workflows/release.yml` (remove the `workspace-tarballs` anchor and both uses, drop `--tarballs "$TARBALLS"` from `plan` and `tag`, rename the step `Tag released versions, recording each tarball's integrity` to `Tag released versions`)
- Modify: `e2e/tests/pipeline.integration.test.ts` (drop `--tarballs`, the expected step names `Pack the workspace through the caller's flake` and the renamed step, and the phase `a released identity is immutable and a reverted manifest is refused`; add one phase asserting that after a released manifest is rewritten `plan` still reports `phase=none`), `e2e/fixture.ts`, `e2e/harness.ts` (drop `WORKSPACE_TARBALLS` and the `.#workspace-tarballs` stub)
- Delete: `docs/release-identity.md`
- Rename and cut: `docs/adoption.md` to `docs/legacy-tags.md`, keeping only the legacy-tags text, with the "no ledger entry and no integrity check" sentence and the identity note reworded to match KTD5
- Modify: `README.md` (documentation table), `docs/commands.md`, `docs/configuration.md` (link to `legacy-tags.md`), `CONTRIBUTING.md` (the `plan` example without `--tarballs`)
- Create: `.changeset/drop-registry-adoption.md`
- Delete: `.changeset/adoption-ledger.md`, `.changeset/tarball-identity.md`
- Modify: `.changeset/changeset-check-fetches-pinned-turbo.md`, `.changeset/legacy-release-tags.md` (drop sentences about removed surface)

**Approach:** The changeset names, per KTD6: `major` for `release-language`, `github-release-engine`, `changeset-engine`, `process-adapter`, `git-adapter`; the apps `github-release-management` and `changeset-management` as `minor`; every other package the gate lists as touched gets `none`. Find the exact set by running the built `changeset-management check origin/main` once, after U6; the deleted packages need no entry. The prose says what a consumer must do: drop `--tarballs` and `release adopt`, and provide `HttpClient` (not `RegistryPort`) to `ChangeEvidenceLive`.

**Test scenarios:** e2e, proved in CI per `docs/solutions/workflow-issues/local-check-ci-runs-the-container-e2e-after-an-e2e-edit.md`: the release job runs `start`, tools build, `Capture this cycle`, `Tag released versions`, `GitHub Releases from the authored changelogs`, wall time, with no failing step; a rewritten released manifest does not refuse `plan`.

**Verification:** `e2e` typecheck and lint pass locally; the CI E2E job is the verdict for its phases.

---

## Verification Contract

Run one command at a time, in this order, from the worktree, inside the dev shell. No full-tree run, no mutants, no local e2e.

| Gate           | Scope                                                                                                                                                                                                                                                                                                    | Applies to  |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| typecheck      | `@systemfsoftware/release-language`, `git-adapter`, `git-hooks-engine`, `github-release-engine`, `changeset-engine`, `process-adapter`, the two apps, `e2e`                                                                                                                                              | U1 to U7    |
| tests          | `github-release-engine`, `changeset-engine`, `process-adapter`, the two apps                                                                                                                                                                                                                             | U2 to U5    |
| lint           | the same packages                                                                                                                                                                                                                                                                                        | all         |
| changeset gate | built `changeset-management check origin/main`                                                                                                                                                                                                                                                           | U7          |
| DEL1 grep      | removed identifiers (`adoption-adapter`, `tarball-adapter`, `RegistryPort`, `LedgerPort`, `TarballPort`, `tagAnnotation`, `tag-integrity-mismatch`, `--tarballs`) return exit 1 outside `docs/plans`, `docs/solutions` and `.changeset/drop-registry-adoption.md` (whose prose names them for consumers) | U6, U7      |
| commit         | repo hooks, files staged by name                                                                                                                                                                                                                                                                         | each commit |

Pending off-host: the full `pnpm check:ci` and the E2E workflow's `containerised release pipeline` job run in CI on the PR head.

## Definition of Done

- R1 to R9 hold; every unit's verification passes.
- The DEL1 grep is clean; no dead fixture, import, dependency or doc link remains.
- One PR is open and marked ready; GitHub's `mergeable` and `mergeable_state` are reported.
- The report names the consumer pins to move: the flake input and `.github/workflows/release.yml`'s `uses: ...release.yml@<sha>` in `systemfsoftware/systemfsoftware`.
- Abandoned-attempt code is removed from the diff.

## Sources

- `packages/github-release-engine/src/plan.ts`, `tag.ts`, `integrity.ts`, `adopt.ts`: the code deleted or reduced.
- `packages/process-adapter/src/turbo-fetch.ts`: the one non-release consumer of `RegistryPort` (KTD2).
- `.changeset/tarball-identity.md`: precedent for `none` entries on dependents.
- `docs/solutions/workflow-issues/local-check-ci-runs-the-container-e2e-after-an-e2e-edit.md`: why e2e is proved in CI.
- `(pack: package-topology, surface-changes-are-versioned.md)`: bump classification.
