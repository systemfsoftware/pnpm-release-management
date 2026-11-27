---
title: changeset check reads a merge of unrelated histories - Plan
type: fix
date: 2026-11-27
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
execution: code
---

# changeset check reads a merge of unrelated histories - Plan

## Goal Capsule

- **Objective:** a pull request that vendors a repository for the first time with `git subtree add --squash` gets a verdict from `changeset check` instead of a crash, and that verdict is no weaker than the one every other merge gets.
- **Means:** when a two-parent merge's parents share no ancestor, its residue is the merge's diff against its first parent, the rule octopus merges already use (KTD1). Every related two-parent merge keeps `git merge-tree` (KTD2).
- **Authority:** the design ruling in the task (KTD1, KTD2, KTD3), then `CODING_STANDARDS.md`, `repos/constitution/CODING_STANDARDS.md` and `GRADERS.md`, then the enrolled packs.
- **Stop conditions:** evidence that the fallback lets a publishable package's change pass without an intent; a need to weaken any other path of the check.
- **Execution profile:** one PR, its task is this check (SF-GATE-5). It is held for two adversarial reviews before merge (see Verification Contract).

---

## Product Contract

### Summary

`changeset check` walks every commit between the merge base and `HEAD`. For a two-parent merge it computes the merge's residue, the paths the merge commit changed beyond merging its parents, with `git merge-tree --write-tree`. Git refuses to merge unrelated histories, so a first-time squashed subtree add, whose second parent is a parentless squash commit, makes `merge-tree` exit 128 and the whole check fails with `EvidenceCommandFailed`. This plan gives that one case a residue and leaves every other case alone.

### Problem Frame

A first-time `git subtree add --prefix=repos/constitution --squash` in a public consumer (`systemfsoftware/effect-cf` PR #1, merge commit `2ed81f7`, "Merge commit 'e49622c…' as 'repos/constitution'") fails the `change intent` job with `git merge-tree --write-tree --no-messages ddcaf6f… e49622c… exited 128: fatal: refusing to merge unrelated histories` (run 46059577522). Later `git subtree pull --squash` merges pass, because their second parent descends from the earlier squash commit, which the first parent already contains. The prefix in that PR (`repos/constitution`) sits outside every workspace member (`packages/*`, `examples/*`, `tools/*`), so the correct verdict there is a pass.

### Requirements

- R1. A two-parent merge whose parents have no common ancestor yields residue equal to the paths that differ between its first parent and the merge commit.
- R2. A two-parent merge whose parents share an ancestor yields residue from `git merge-tree --write-tree --no-messages <first> <second>` exactly as today.
- R3. Any failure to decide whether the parents are related (a `git merge-base` exit other than 0 or 1) fails the check, naming the command, its exit status and its stderr (`CODING_STANDARDS.md`, "A failure names its command").
- R4. A publishable package that owns a path the unrelated merge introduced still needs a live intent naming it; the check still fails without one.
- R5. `docs/change-intents.md` states how a merge of unrelated histories is read.

### Acceptance Examples

- **First vendoring outside the workspace:** Given a squashed subtree add under a directory no member owns, When `check` runs, Then it passes with no intent. Covers R1.
- **First vendoring inside a published package:** Given a squashed subtree add under `packages/<published>/vendor/`, with no intent naming that package, When `check` runs, Then it fails naming the package. Covers R1, R4.
- **Subtree update:** Given a later `git subtree pull --squash` merge, When `check` runs, Then its residue comes from `merge-tree` as before. Covers R2.

### Scope Boundaries

- Not changing how octopus merges, single-parent commits or root commits are read.
- Not adding `--allow-unrelated-histories` to `merge-tree` (rejected in KTD1).
- Not reading commit messages. The check never reads them (see Sources, "Where intent comes from").

---

## Planning Contract

### Key Technical Decisions

- KTD1. For a two-parent merge, run `git merge-base <first> <second>` first. Exit 1 (no common ancestor) selects `namesBetween(root, first, sha)`, the same rule `commitOf` uses for three or more parents (`packages/process-adapter/src/history-io.ts:130`). (session-settled: user-directed — chosen over `merge-tree --allow-unrelated-histories`: a squash commit's tree sits at the vendored repository's root, not under the prefix, so a merge against an empty base produces a tree with the vendored files at root, and the residue would be meaningless rather than the import.)
- KTD2. Exit 0 keeps the existing `mergeResidue` path byte for byte (`history-io.ts:94-107`). (session-settled: user-directed — chosen over diffing every merge against its first parent: on a related merge that diff counts the target branch's own changes and hides an evil-merge resolution, which `merge-tree` exists to isolate.)
- KTD3. Exit 1 alone is the trigger. No second test of "the second parent is a root" is added: `merge-base` exit 1 already means the two histories share no commit, so a second test can only disagree with it by being wrong. (session-settled: user-directed — chosen over an extra `rev-list` disjointness test: redundant with the exit code.)
- KTD4. The fallback cannot weaken the check. Residue only moves a path from release-owned to feature-owned (`packages/changeset-engine/src/release-commits.ts:76`, `:81`), and feature-owned paths are the ones that need intents. Diffing against the first parent lists every path the unrelated merge introduced, so it can only make more paths feature-owned than a narrower residue would.
- KTD5. `git merge-base` is called through `gitOutcome`, not `gitText`, so exit 1 is a value and every other non-zero exit fails through `failed(...)` with the command, exit status and stderr (R3).

### High-Level Technical Design

Directional only:

```text
two parents (first, second):
  merge-base first second
    exit 0 -> mergeResidue(sha, first, second)      # unchanged
    exit 1 -> namesBetween(first, sha)              # unrelated histories
    other  -> fail EvidenceCommandFailed(command, code, stderr)
```

### Assumptions

- The squashed root commit the subtree add brings in is also listed by `rev-list` and read as a root commit (`history-io.ts:118-122`). Its paths are the vendored repository's root-level names. They only add to the feature-touched set, so a collision with a real root path (`README.md`, `package.json`) can make that path feature-owned, never release-owned. This is today's behavior for root commits and stays out of scope.

### Open Questions

- Should `tests/__fixtures__/FakeHistory.ts:114-119` model an unrelated merge the way the live adapter now does? It computes residue as "differs from both parents", which agrees with KTD1 for a prefixed import but not in general. Deferred: only matters if a test candidate below is admitted.

---

## Implementation Units

### U1. Unrelated-history residue in the git adapter

- **Goal:** R1, R2, R3.
- **Files:** `packages/process-adapter/src/history-io.ts`.
- **Approach:** in the two-parent branch of `commitOf` (`:127-128`), decide relatedness with `merge-base` per KTD1, KTD5; route exit 1 to `namesBetween(root, first, commit)`; leave `mergeResidue` untouched.
- **Pattern:** the octopus branch at `:130`; `gitOutcome` plus `failed` as `mergeResidue` uses them at `:102-103`.
- **Test scenarios:** none planned; see Test candidates.

### U2. Documentation and learning

- **Goal:** R5, and the repository's rule that a fix ships its learning (`AGENTS.md`, Process).
- **Files:** `docs/change-intents.md` (the bullet "A merge commit's own edits, beyond merging its parents, count as feature changes"), a new record under `docs/solutions/runtime-errors/`, a `.changeset/` intent for `@systemfsoftware/process-adapter` at the bump the repository's rules give a bug fix.

---

## Test candidates

None is part of this plan. Each needs its own admission before it is written.

- T1. A real-git integration test: a temporary repository with an unrelated root merged by `git subtree add --prefix=vendor/sub --squash`; `check` passes when `vendor/sub` is unowned and fails naming the package when a published member owns it. Catches: a regression back to the crash, and a fallback that drops the intent requirement (R1, R4). The repository already runs real git in integration tests (`packages/process-adapter/tests/__fixtures__/real-git.ts`, `deleted-packages.integration.test.ts`); the `testing` pack's `io-runs-in-microvms-never-on-the-host.md` forbids spawning `git` on the host, so the admission has to weigh that rule against the existing fixture.
- T2. A changeset-engine Feature through `FakeHistory`: an unrelated two-parent merge whose residue touches a published package fails without an intent. Catches: R4 regressing in the pure core. Likely adds nothing over existing residue coverage.
- T3. A shared contract case for the history port: live adapter and `FakeHistory` agree on an unrelated merge's residue (`testing` pack, `port-fakes-share-a-contract-suite.md`). Catches: fake and adapter drifting apart.

---

## Verification Contract

- `pnpm typecheck --filter @systemfsoftware/process-adapter` and `pnpm lint --filter @systemfsoftware/process-adapter`; no local full suite or e2e.
- SF-GATE-5 proof, in CI on the PR: re-run the `change intent` job of the failing consumer PR (effect-cf #1) against a build of this branch and show it now passes; show a merge of related histories still reports the same residue as before.
- Before merge: a written adversarial review recorded on the PR, then an independent adversarial review of the diff that asks first whether the approach is right and then for P0/P1 defects. Neither may leave an unrefuted P0/P1.

## Definition of Done

- The failing consumer PR's `change intent` job passes on a released build of this fix.
- The PR carries U1, U2, the intent and the learning record, and both review records.

## Sources / Research

- **The crash:** `history-io.ts:101-103` fails on any `merge-tree` exit other than 0 or 1; the consumer run logs exit 128, "refusing to merge unrelated histories".
- **Where intent comes from:** neither the merge commit's message nor the PR's commit messages. An intent is a Markdown file in `.changeset/` (`docs/change-intents.md`, "Change intents"). The check reads the intent files present at the merge base (`packages/changeset-engine/src/gate-changes.ts:168`) and the net diff from merge base to head (`gate-changes.ts:178`, `ChangeEvidenceLive.ts:20`). Commits feed it only as tree diffs: `commitsOf` (`history-io.ts:133-148`) gives each commit's changes and residue, `releaseCandidatesOf` reads intent deletions from those changes (`release-commits.ts:21-38`), and `changedPathsOf` sorts paths into release- and feature-owned (`release-commits.ts:61-83`). No git call in `packages/process-adapter/src` reads a message (no `log`, `--format`, `--pretty` or `cat-file commit`).
- **Prior plan:** `docs/plans/2026-11-22-1642-fix-gate-rederives-release-commits-plan.md` (R6: merge residue counts as a feature change).
