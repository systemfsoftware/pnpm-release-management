---
title: Turbo repositories refuse the paths gate - Plan
type: feat
date: 2026-10-12
topic: turbo-repos-refuse-paths-gate
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
execution: code
supersedes: docs/plans/2026-10-12-1922-feat-turbo-repos-refuse-paths-gate-plan.md
---

# Turbo repositories refuse the paths gate - Plan

## Goal Capsule

- **Objective:** In a repository that Turbo drives, the changeset gate decides which publishable packages a change touches only from Turbo's evidence. A `paths` configuration there is refused with a line that names the `turbo` fix, while repositories without a Turbo config keep `paths`.
- **Means:** the paths evidence adapter probes for a root Turbo config on both sides of the comparison and refuses with a new typed evidence refusal (KTD1, KTD2).
- **Product authority:** the root operator's acceptance outcome for this unit; this plan does not widen it.
- **Stop conditions:** a change that would touch a consumer repository's configuration, the turbo evidence route, or the release phases is out of scope and stops the unit.
- **Execution profile:** one branch, units U1 to U3 in order, verified by the repository's own gates and real-tool runs against scratch copies of public consumers.
- **Open blockers:** none.

---

## Product Contract

### Summary

When the root holds a Turbo config, the paths gate refuses with a typed, stable, agent-readable refusal naming `"gate": { "strategy": "turbo" }`. Everything else about the gate is unchanged.

### Problem Frame

`gate.strategy` is free configuration: nothing compares it with the repository it describes. A Turbo repository can select `paths`, and the gate then classifies changes by member directory instead of asking Turbo which build inputs moved. On a public Turbo consumer that selects `paths`, a change to `turbo.json`'s build outputs passed the paths gate, while the turbo gate on the same commit demanded an intent for the publishable package whose build it changes. The consumer's configuration comment justifies `paths` with a condition (a base without `turbo.json`) that stopped being true once its trunk carried `turbo.json`. Nothing tells the consumer, or the agent maintaining it, that the configuration contradicts the repository.

### Requirements

**Which repositories Turbo drives**

- R1. A comparison is Turbo-driven exactly when the repository root holds `turbo.json` or `turbo.jsonc` at both the comparison base and the head, the two revisions the turbo gate dry-runs.
- R2. A comparison that is not Turbo-driven keeps the `paths` gate with its current behavior, including a pull request that introduces or removes the repository's Turbo config.

**The refusal**

- R3. Under `gate.strategy: paths` in a Turbo-driven repository, `changeset-management check` refuses before classifying any change and exits non-zero.
- R4. The refusal is a typed gate refusal carrying the Turbo config file it found, rendered as one stable, agent-readable line that names that file and the fix `"gate": { "strategy": "turbo" }` in `release.jsonc`.
- R5. No configuration, flag, or input lets a Turbo-driven repository fall back to `paths`.

**Unchanged behavior**

- R6. Under `gate.strategy: turbo`, evidence still comes from the consumer's installed, lockfile-pinned Turbo, and a mismatched Turbo pin is still refused with the existing `turbo pin unusable` line.
- R7. A publishable-package change with no intent is still refused with the existing missing-intent report, under both strategies.
- R8. Phases other than the changeset gate (version, release, publish) neither consult nor enforce the gate strategy.

### Acceptance Examples

- AE1. **Covers R1, R3, R4.** **Given** a repository with root `turbo.json` and `"gate": { "strategy": "paths" }`, **when** the check runs, **then** it refuses with the fix-naming line and names no packages.
- AE2. **Covers R1, R3.** **Given** the same repository with `turbo.jsonc` instead of `turbo.json`, **when** the check runs, **then** it refuses the same way, naming `turbo.jsonc`.
- AE3. **Covers R2.** **Given** a repository with no root Turbo config and `"gate": { "strategy": "paths" }`, **when** a publishable member's file changes, **then** the paths gate names that member as before.
- AE4. **Covers R6, R7.** **Given** a Turbo consumer on `"gate": { "strategy": "turbo" }`, **when** a publishable package's build input changes without an intent, **then** the gate refuses with the missing-intent report; **when** the lockfile's Turbo pin differs from the installed Turbo, **then** it refuses with `turbo pin unusable`.
- AE5. **Covers R1, R2.** **Given** a pull request that adds `turbo.json` to a repository whose base has none, under `"gate": { "strategy": "paths" }`, **when** the check runs, **then** the paths gate decides it, because Turbo cannot dry-run that base; the next pull request is refused under AE1.
- AE6. **Covers R1, R2.** **Given** a pull request that removes the repository's `turbo.json`, under `"gate": { "strategy": "paths" }`, **when** the check runs, **then** the paths gate decides it, because Turbo cannot dry-run that head.

### Key Decisions

- **The paths evidence source refuses, not the release config.** Refusing at config load would also fail the version and release phases, so a consumer bumping only its release-workflow pin could break on release day. Governs R3, R8.
- **"Turbo-driven" means Turbo can produce the evidence: a root Turbo config on both sides of the comparison.** Turbo refuses to run without a root config, so a Turbo dependency alone drives nothing, and the turbo gate dry-runs both the base and the head. Requiring the config on both sides keeps the pull request that adopts or drops Turbo decidable. `turbo` 2.11.5 runs from `turbo.jsonc` alone. Governs R1, R2.
- **Ship on the trunk; consumers adopt at their pin bump.** Consumers call the reusable workflow at a commit SHA, and the workflow builds the check at that SHA. A consumer's pin-bump pull request runs the new check on itself, so the refusal and its fix land in the same pull request and the consumer's trunk never sees the gate fail. A consumer that calls the workflow at a branch instead of a SHA is refused on its next pull request; no fallback is shipped for it. Governs R5.
- **Rejected: inferring the strategy from the Turbo config.** A configured `paths` would then be silently ignored, which is the silent fallback R5 forbids, and every consumer's config would change meaning.

### Scope Boundaries

- Changing any consumer repository's gate configuration.
- Version-range or turbo-version checks on the Turbo config itself; Turbo already refuses a config it cannot read.
- Turbo remote cache or networked evidence; evidence stays a local dry run.
- Catalog-flip detection, which neither strategy sees today.

### Sources / Research

- `packages/release-language/src/Config.schema.ts` (`PathsGate`), `packages/changeset-engine/src/gate-changes.ts` (strategy routing), `packages/process-adapter/src/ChangeEvidenceLive.ts` (`pathsEvidence`, `pathsTouched`).
- `apps/changeset-management/src/render.ts` maps every evidence refusal to its line.
- `.github/workflows/changeset-check.yml` builds the release tools at `job.workflow_sha` and installs the caller's workspace before the check.
- Turborepo reads `turbo.json`, then `turbo.jsonc`, and errors when both exist ([configuration reference](https://turborepo.dev/docs/reference/configuration)); `turbo.jsonc` arrived in Turborepo 2.5 ([blog](https://turborepo.dev/blog)).
- `docs/solutions/logic-errors/lint-gate-passes-while-linting-nothing.md`: a gate never observed failing is not known to be connected, so the refusal is proven by a negative control on a real repository.

Product Contract preservation: Product Contract unchanged.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **The probe runs inside `pathsEvidence` right after the branch lookup, before any changed-path read or classification.** The refusal costs no member enumeration, and every caller of paths evidence inherits it. Governs R3.
- KTD2. **Both sides are read from git: the base at the caller's `ref`, the head at the branch the paths gate classifies.** `git ls-tree --name-only <rev> -- turbo.json turbo.jsonc` exits 0 when neither is present. The refusal is then a function of the compared revisions alone, so uncommitted working-tree state can neither hide nor invent a Turbo config. An unreadable revision stays the existing `EvidenceCommandFailed`, never "not Turbo-driven". Governs R1, R2, R5.
- KTD3. **The refusal is a new `S.TaggedError` in the `EvidenceRefusal` union carrying the head's Turbo config file name.** It follows `TurboPinUnusable`'s shape, travels the existing `ChangeEvidenceRefusal` channel to `renderRefusal`, and `Match.tagsExhaustive` makes the render case a compile error until written. When both files exist the refusal names `turbo.json`, the first file Turbo looks for. Governs R4.
- KTD4. **The rendered line starts with a fixed stem and names the file and the fix.** Shape: `paths gate refused: <file> makes turbo the source of change evidence — set "gate": { "strategy": "turbo" } in release.jsonc`. The stem `paths gate refused:` is the stable, greppable part. Governs R4.
- KTD5. **Changeset: `release-language` major, `process-adapter` minor.** This mirrors `.changeset/command-unstartable.md`: a union that gains a member breaks exhaustive matches for adapter authors, and the adapter gains a refusal.

### Sequencing

U1 adds the type and its rendered line, so U2's adapter code and test can construct and assert it. U3 documents the shipped behavior.

### System-Wide Impact

- Consumers call `.github/workflows/changeset-check.yml` at a commit SHA, so the refusal reaches each consumer at its next pin bump, inside that bump's own pull request (Key Decision on shipping). A consumer that calls the workflow at a branch is refused on its next pull request.
- The e2e fixture repository holds no root Turbo config and keeps `paths`; this repository's own gate already uses `turbo`.

---

## Implementation Units

### U1. Typed refusal and its rendered line

- **Goal:** the evidence refusal exists, is exported, and renders as one stable line.
- **Requirements:** R4.
- **Dependencies:** none.
- **Files:** `packages/release-language/src/Gate.schema.ts`, `packages/release-language/src/index.ts`, `apps/changeset-management/src/render.ts`.
- **Approach:**
  1. Declare the tagged error per KTD3 with one field naming the Turbo config file, and add it to `EvidenceRefusal`.
  2. Export it beside `TurboPinUnusable`.
  3. Add its `Match.tagsExhaustive` case per KTD4.
- **Patterns to follow:** `TurboPinUnusable` declaration, export, and render case.
- **Test scenarios:** Test expectation: none -- a declaration and a total render mapping; the compiler enforces the case and U2 plus the real-tool runs observe it.
- **Verification:** typecheck passes across the workspace with the new union member.

### U2. Paths evidence refuses when Turbo drives the comparison

- **Goal:** `pathsEvidence` refuses before classifying when a root Turbo config exists at both `ref` and the classified head, and behaves as before otherwise.
- **Requirements:** R1, R2, R3, R5; AE1, AE2, AE3, AE5, AE6.
- **Dependencies:** U1.
- **Files:** `packages/process-adapter/src/ChangeEvidenceLive.ts`, `packages/process-adapter/src/evidence-io.ts`, `packages/process-adapter/tests/paths-under-turbo.integration.test.ts` (new), `e2e/tests/pipeline.integration.test.ts`.
- **Approach:**
  1. Add one git probe per revision per KTD2, beside the existing evidence I/O helpers.
  2. Call it in `pathsEvidence` per KTD1, failing with U1's refusal when both revisions hold a config.
- **Patterns to follow:** `deletedAt` and `gitLines` in `evidence-io.ts` for git reads at a revision; the fixture builder, `git` helper, `fakeGitChanging`, and `Effect.exit` refusal idiom in `deleted-packages.integration.test.ts` and `turbo-pin.integration.test.ts`.
- **Test scenarios:**
  - Covers AE1. A repository with root `turbo.json` at base and head and a changed publishable member: paths evidence fails with the new refusal naming `turbo.json`.
  - Covers AE2. The same with `turbo.jsonc` on both sides: the refusal names `turbo.jsonc`.
  - Covers AE3. No root Turbo config on either side: paths evidence succeeds and names the changed publishable member as touched.
  - Covers AE5. `turbo.json` added on the head only: paths evidence succeeds and names the member.
  - Covers AE6. `turbo.json` removed on the head: paths evidence succeeds and names the member.
  - Covers R1, R5. `turbo.json` at base and head with its deletion left uncommitted in the working copy: paths evidence is still refused naming `turbo.json`.
  - Covers AE1, R3, R4 through the real CLI. The e2e pipeline gains a phase that commits a root `turbo.json`, changes a publishable member on top, and runs `changeset-management check` against the commit that added the config: exit 1 with the `paths gate refused: turbo.json` line. A unit test of the renderer would need a test-only package export, so the line is pinned at the CLI.
- **Verification:** the new feature passes, the existing process-adapter suites stay green, and their fixtures still need no Turbo config.

### U3. Documentation and change intent

- **Goal:** consumers and their agents can read the rule and the fix.
- **Requirements:** R2, R4, R8.
- **Dependencies:** U2.
- **Files:** `README.md`, `.changeset/turbo-repos-refuse-paths-gate.md` (new).
- **Approach:**
  1. Update the `gate.strategy` row and add a short gate paragraph: `paths` is for repositories without a root Turbo config, the transition rule from R1, the refusal line, and the follow-on `turbo pin unusable` line when the lockfile does not pin `turbo` as a root devDependency.
  2. Write the change intent per KTD5, naming the breaking union member for adapter authors.
- **Test scenarios:** Test expectation: none -- documentation and release intent.
- **Verification:** `pnpm format:check` passes and the README states the rule once.

---

## Verification Contract

| Gate                  | Command or action                                                                                                                                                                    | Proves                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Static gates          | `pnpm check:ci`                                                                                                                                                                      | format, lint, typecheck, build and every vitest suite, as CI runs them |
| New behavior          | `pnpm --filter @systemfsoftware/process-adapter test`                                                                                                                                | U2 scenarios and existing evidence suites                              |
| Real refusal          | release tools built from the branch via `nix build .#release-tools`, run as `changeset-management check <base>` on a scratch copy of a public Turbo consumer configured with `paths` | AE1 through the real CLI, with the stable line                         |
| Adoption pull request | same tools on that consumer's commit that introduced `turbo.json`, compared with its parent                                                                                          | AE5                                                                    |
| Turbo route unchanged | same tools on a scratch Turbo consumer with `turbo`: a source change with an intent, the same without one, and a lockfile Turbo pin edit                                             | R6, R7                                                                 |
| Non-Turbo `paths`     | same tools on a scratch copy of a public repository with no Turbo config                                                                                                             | AE3                                                                    |
| e2e refusal           | CI e2e job (container; not run locally)                                                                                                                                              | R3, R4 through the CLI: exit 1 and the stable line                     |
| Workflow lint         | `actionlint` over `.github/workflows/`                                                                                                                                               | no workflow regression (no workflow file changes in this plan)         |

Mutation testing is not run locally; mutation evidence comes from the main-branch CI.

---

## Definition of Done

- U1 to U3 landed; every Verification Contract row executed and its output recorded in the pull request.
- The rendered refusal was observed on a real Turbo consumer copy, and the paths gate was observed passing on a non-Turbo copy.
- No consumer repository was modified; scratch copies live outside this repository.
- No dead-end or experimental code remains in the diff.
