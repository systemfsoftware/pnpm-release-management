---
title: The changeset gate re-derives release commits - Plan
type: fix
date: 2026-11-22
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
execution: code
---

# The changeset gate re-derives release commits - Plan

## Goal Capsule

- **Objective:** a consumer's release PR passes `changeset-check.yml` on any branch, including a merge-queue draft, while no other change can drop, smuggle past or partially consume a pending intent, and a package moved only through an accounted upstream needs no intent of its own.
- **Means:** each intent-consuming commit is replayed through the repository's own bump cell from its parent and must equal it byte for byte (KTD1); everything else is gated as a feature change (KTD2, KTD6).
- **Authority:** the maintainer's ruling in the task (user-directed KTDs), then the adversarial-review rulings the maintainer delegated (user-approved KTDs), then `CONSTITUTION.md` and `CODING_STANDARDS.md`.
- **Stop conditions:** a settled decision proves infeasible; a grader would need weakening.
- **Execution profile:** one PR on `feat-gate-rederive-release`, superseding #124; the executor opens it and watches CI.

---

## Product Contract

### Summary

`changeset-management check <base>` decides from git history alone. A commit that deletes intents present at the merge base, and adds or edits none, is a release commit when it is exactly what `version bump` produces from its parent with exactly those intents. Every pending release at the merge base must survive to head, either consumed by such a commit or still named at an equal or higher bump. Every other change is a feature change: each publishable package it directly modifies needs a live intent, and under `strategy: 'turbo'` a package moved only through its task dependencies passes when every moved dependency is accounted for. The workflow loses its branch-name exemption.

### Problem Frame

The gate failed a release PR whenever it ran under a branch other than `changeset-release/main`, because consuming an intent deletes it (timescale-drizzle PR #32, run 45005781652 on `mergify/merge-queue/bd2037b94e`). #124 recognised a "release shape" by file kinds; an adversarial review showed it lets a non-release PR delete an intent and smuggle manifest edits, drops siblings of a partially consumed intent, refuses legitimate surfaces and batched drafts, and keeps failing transitive dependents under turbo.

### Requirements

**Release commits**

- R1. A commit that deletes an intent present at the merge base and adds or modifies no intent is replayed: when its tree equals the bump of its parent with exactly the intents it deleted, it is a verified release commit. When it diverges and touches only intent files, it is an intent edit left to R5; otherwise the gate refuses naming every divergent path.
- R2. A replay that the bump refuses (malformed or unknown-package intent) refuses the gate, naming the commit and the refusal.
- R3. A release commit whose parent is not the merge base is refused as stale when the parent-to-merge-base diff touches `release.jsonc`, `pnpm-workspace.yaml`, any `package.json`, or a non-intent file under the changeset directory.

**Intent conservation**

- R4. A commit that adds or modifies an intent file is an intent edit, never a release commit; intent edits are judged only by R5, so splitting, merging, moving, rewriting across commits and raising a bump all pass.
- R5. For each package, the highest bump among merge-base intents (read at the merge base) that no verified release commit consumed must be matched or exceeded by the highest bump among intents live at head (read at head); otherwise the gate refuses naming the package and the merge-base intents that carried it. A merge-base intent that was deleted or modified and does not parse at the merge base refuses by path. In-place downgrades, retargets and deletions of a range-added replacement therefore refuse.

**Feature changes**

- R6. A changed path is release-owned only when verified release commits touch it and no feature commit or merge residue does; every other changed path is feature-owned.
- R7. Each publishable package owning a feature-owned path (deepest member directory wins) needs a live intent naming it; `none` names it.
- R8. Under `turbo`, a moved publishable package that owns no changed path passes when it has moved task dependencies and every one is accounted (named, released, or itself transitively accounted); with none, it passes only when no feature-owned path is a changed global or task input and the non-file hash inputs did not change.

**Robustness**

- R9. The head is `HEAD`'s sha (detached works), the merge base is computed once and drives every diff and the base dry run; a shallow clone is refused with the `fetch-depth: 0` fix.
- R10. `changesetDir` is normalised (`./.changeset`, `.changeset/` and `.changeset` agree).
- R11. `changeset-check.yml` runs on every pull-request head, including the release branch and queue drafts.

### Acceptance Examples

- **Release PR on a queue branch:** Given a repository shaped like timescale-drizzle at PR #32 (changesets strategy, paths gate), When `check` runs on branch `mergify/merge-queue/<id>` holding the merge of the real release commit, Then it passes. Covers R1, R11.
- **Smuggled manifest edit:** Given the release commit plus a `bin` entry added to the bumped manifest, Then the gate refuses naming that manifest. Covers R1.
- **Batched draft:** Given a draft merging a feature PR (with its intent) and the release PR that both touch one package, Then it passes; without the feature intent it refuses. Covers R6, R7.

### Scope Boundaries

- No release-actor or head-ref check (KTD7).
- A root workspace member stays outside gate evidence, as today.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **Replay oracle in a temporary worktree.** `git worktree add --detach <tmp> <parent>`, delete the intents the commit does not consume, run `bumpCell` in-process with the stores rooted at `<tmp>` and `<tmp>`'s `release.jsonc`, restore the removed intents, stage exactly as `commitRelease` does (`git add --update`, then the untracked paths among the created changelogs derived by one shared function that `pr` also uses), `git write-tree` with `core.autocrlf=false`, compare with the commit's tree, list divergence with `git diff-tree -r --name-only`. (session-settled: user-directed — chosen over #124's path heuristic: smuggling, partial consumption and rejected surfaces.)
- KTD2. **Per-commit decomposition.** `git rev-list --parents H ^B`. Non-merge commits are diffed against their parent with `--no-renames`. A two-parent merge's residue is the diff between `git merge-tree --write-tree p1 p2` (exit 0 or 1) and the merge tree; an octopus's residue is every path it changes against its first parent. Residues are feature-owned. (session-settled: user-approved — chosen over a whole-range replay: batches mix feature merges and the release commit.)
- KTD3. **Release detection by replay; intent edits by (package, bump) conservation.** Conservation is computed once over the range (R5) as a per-package highest-bump comparison, the multiset rule settled in review made exact for merged duplicates, in-place edits and multi-commit rewrites. (session-settled: user-approved — chosen over git rename detection and 1-to-1 pairing: splitting or merging intents would read as consumption.)
- KTD4. **Staleness check (R3).** (session-settled: user-approved — chosen over replaying at the merge base: the oracle must start from the commit's own parent.)
- KTD5. **Fail-closed ownership (R6).** (session-settled: user-approved — chosen over defaulting unexplained paths to release-owned: criss-cross merge bases leave paths no listed commit touches.)
- KTD6. **Turbo accounting as a least fixpoint over every moved task dependency (R8).** (session-settled: user-approved — chosen over "some moved dependency": a bundled private upstream would ship unreleased.)
- KTD7. **No actor check.** (session-settled: user-approved — chosen over checking the release bot: the oracle is stronger, and an actor check breaks local and queue runs.)
- KTD8. **Effects at the edge.** `ChangeEvidencePort` becomes git and turbo fact primitives (range, commits with changes and residues, diff between revs, file at rev, members, turbo comparison). The release classifier and the gate decision are pure in `changeset-engine`; the cell's `read` uses the classifier to choose what to replay and asks a new `ReleaseReplayPort` (release-language) for each replay; `decide` is a pure `Workflow` over the gathered facts.
- KTD9. **Replay lives at the composition root.** `ReleaseReplayLive` sits in `apps/changeset-management` (it wires `version-engine`, `workspace-adapter`, `changesets-adapter`). `bumpRequestOf` and its target helpers move into `version-engine` as `bumpInputOf` so both apps derive the bump input from one function.
- KTD10. **One intent parser.** #124's `parseIntentDocument` moves to `release-language` and the changeset store uses it, so live and deleted intents parse identically; intent-file recognition is one predicate there too, excluding exactly what the bump excludes (dotfiles, any-case `readme.md`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`); `ChangesetStoreLive`, `ChangesetsPortLive` and the gate all use it.
- KTD11. **Turbo dry runs only when a feature-owned path exists,** at the merge base and head; the dry-run schema adds `dependencies`, `inputs`, `hashOfExternalDependencies` and `globalCacheInputs`.

### High-Level Design

```text
read:  range(root, ref)            -> {head, base, mergeBase}   (refuse shallow)
       commits(range)              -> [{sha, parents, changes, residue}]
       fileAt(rev, intentPath)     -> texts of deleted/added intents per commit, intents at M and H
       classify (pure)             -> release commits {sha, parent, consumed}, intent edits, feature commits
       changed(parent, M)          -> staleness paths per release commit whose parent != M
       replay(release commit)      -> {divergent} | refusal   (ReleaseReplayPort)
       members(M)                  -> head members, deleted members
       turbo(M, H) if feature-owned paths exist
decide (pure Workflow): refusals in order -> unreplayable / diverged / stale / malformed merge-base intent / release dropped (R5) / unknown package named by a live intent (existing) / intent missing (existing); else Vacant | Gated
write: report text
```

### Assumptions

- The release workflow commits the bump output staged by `commitRelease`; the replay stages by the same rule, with the created-changelog list from one shared function.
- A defect from the bump inside the replay (`ChangesetsPortLive` dies on unreadable packages or config) is caught and reported as the unreplayable refusal.
- The checking workflow builds its tools at its own revision, like the release workflow; tool skew between them is a refusal, not a bypass.

---

## Implementation Units

### U1. Vocabulary: intent document, evidence facts, replay port, refusals

- **Goal:** release-language carries the shared parser, the fact shapes and the new refusals.
- **Requirements:** R2, R4, R5, R9, R10.
- **Files:** `packages/release-language/src/IntentDocument.ts`, `Gate.schema.ts`, `ChangeEvidencePort.ts`, new `ReleaseReplayPort.ts`, `index.ts`; `packages/workspace-adapter/src/ChangesetStoreLive.ts`.
- **Approach:** KTD8, KTD10. New tagged refusals: release diverged, release unreplayable, release stale, release dropped, merge-base intent malformed, shallow clone; the existing unknown-package and intent-missing refusals stay. The created-changelog derivation moves from `pull-request.ts` into release-language.
- **Test scenarios:** `parseIntentDocument` over literal documents (valid, missing fence, bad bump); changeset-dir normalisation literals.
- **Verification:** `pnpm exec turbo typecheck lint test --filter=@systemfsoftware/release-language --filter=@systemfsoftware/workspace-adapter`.

### U2. Git and turbo facts in process-adapter

- **Goal:** the evidence port returns range, commits with changes and merge residues, file-at-rev, diff-between, members, and the turbo comparison at M and H.
- **Requirements:** R6, R8, R9.
- **Dependencies:** U1.
- **Files:** `packages/process-adapter/src/ChangeEvidenceLive.ts`, `evidence-io.ts`, `turbo-evidence.ts`, `change-verdict.ts`, `TurboDryRun.schema.ts`, new `history-io.ts`; existing tests updated.
- **Approach:** KTD2, KTD11. Deepest-prefix ownership helper.
- **Test scenarios:** real-git: detached HEAD range; shallow clone refused; conflict-resolution merge reports its residue; clean merge reports none.
- **Verification:** `pnpm exec turbo typecheck lint test --filter=@systemfsoftware/process-adapter`.

### U3. Pure classifier and gate decision

- **Goal:** `changeset-engine` classifies commits, owns paths, applies the turbo fixpoint and decides.
- **Requirements:** R1, R3–R8.
- **Dependencies:** U1, U2.
- **Files:** `packages/changeset-engine/src/gate-changes.ts`, `gate-changes.workflow.ts`, new `release-commits.ts`; tests in `src/__tests__/` and `tests/`.
- **Approach:** KTD3–KTD6, KTD8.
- **Test scenarios:** property tests over generated commit histories built from domain contracts (intents as package/bump maps, not the decider's own output): a transitive-only package passes; a private unnamed upstream does not account; a global-only move passes when only release-owned inputs changed and refuses when a feature-owned global input changed; an intent split passes; two same-package intents merged at the higher bump pass; a downgraded split refuses; an in-place downgrade and an in-place retarget refuse; a split whose replacement is deleted later refuses; a stale release commit refuses when the parent-to-merge-base diff touches `release.jsonc` or a `package.json` and passes when it touches only source; a malformed modified merge-base intent refuses.
- **Verification:** `pnpm exec turbo typecheck lint test --filter=@systemfsoftware/changeset-engine`.

### U4. Replay adapter and app wiring

- **Goal:** `changeset-management check` replays release commits with the real bump.
- **Requirements:** R1, R2, R11.
- **Dependencies:** U3.
- **Files:** `packages/version-engine/src/bump-input.ts`, `apps/version-management/src/boundary.ts`, `apps/changeset-management/src/release-replay.ts`, `main.ts`, `package.json`, new `apps/changeset-management/tests/`.
- **Approach:** KTD1, KTD9.
- **Test scenarios (real git, real bump, both strategies):** a real `version bump` commit passes; the same commit plus a manifest `bin` edit refuses; a release consuming a two-package intent while bumping one refuses; a release plus `.github/workflows/x.yml` refuses; a moved intent passes as a feature edit; an intent deleted in one commit and rewritten in a later one passes; deleting `.changeset/AGENTS.md` is not a consumption; a malformed consumed intent refuses by name; a batched draft (feature merge with intent + release merge touching one package) passes and refuses without the feature intent; the timescale-drizzle PR #32 shape passes on `mergify/merge-queue/<id>`.
- **Verification:** `pnpm exec turbo typecheck lint test --filter=@systemfsoftware/changeset-management --filter=@systemfsoftware/version-management --filter=@systemfsoftware/version-engine`.

### U5. Workflow, docs, intent, learning

- **Goal:** the exemption is gone and the docs state the rule.
- **Requirements:** R11.
- **Files:** `.github/workflows/changeset-check.yml`, `docs/commands.md`, `docs/change-intents.md`, `docs/ci.md` if it names the exemption, `.changeset/<slug>.md`, `docs/solutions/logic-errors/gate-read-a-branch-name-as-intent.md` (written by `ce-compound`).
- **Verification:** `pnpm format:check`; the PR's own `changeset check` passes on CI.

---

## Verification Contract

| Gate        | Command                                                                                                                                                                  | Proves       |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| Per package | `pnpm exec turbo typecheck lint test --filter=<pkg>` for every package touched                                                                                           | units U1–U4  |
| Format      | `pnpm format:check`                                                                                                                                                      | formatting   |
| End to end  | the U4 timescale-drizzle-shaped scenario, plus `changeset-management check` built from the branch on a scratch clone shaped like PR #32 under `mergify/merge-queue/<id>` | R1, R11      |
| CI          | the PR's `checks / check` and its own changeset gate                                                                                                                     | whole change |

Never run `pnpm check:ci` or the container e2e locally.

---

## Definition of Done

| Review finding                                                                   | Answered by              |
| -------------------------------------------------------------------------------- | ------------------------ |
| P0-1 transitive dependents                                                       | R8, KTD6                 |
| P0-2 smuggling via a deleted intent                                              | R1, R5, KTD1             |
| P0-3 partial consumption                                                         | R1, R5                   |
| P0-4 batched drafts                                                              | R6, KTD2, KTD5           |
| P1 renamed intent; changesetDir; piggyback; surfaces and root; merge base vs ref | R4/R5; R10; R1; KTD1; R9 |
| P2 nested workspaces; `none` asymmetry; malformed deleted intent                 | R7; R5; R5 and R2        |

- Every R has a test that fails when it breaks; each review finding (P0-1..P0-4, P1, P2) maps to a named test in the PR body.
- The PR is open by the bot, names #124 as superseded, pastes the end-to-end output, and its checks are green.
- No abandoned-attempt code in the diff; the learning is in `docs/solutions/`.
