---
title: A fixture-seeded directory hid bump's fresh-checkout failure
date: 2026-10-13
category: runtime-errors
module: workspace-adapter
problem_type: runtime_error
component: service_layer
symptoms:
  - "`version-management bump` exits 1 with `ChangelogUnwritable: path=.changeset/changelogs/<member>@<version>.md reason=NotFound`"
  - "The Release (dogfood) lane fails at its version step on every push to main whose intents move a member, while CI and E2E stay green"
root_cause: incomplete_setup
resolution_type: code_fix
severity: critical
tags: [changelog, changelog-dir, registry-storage, fixture, fresh-checkout, e2e, gitkeep]
related_components:
  - e2e/fixture.ts
  - packages/version-engine/tests/changesets.integration.test.ts
---

# A fixture-seeded directory hid bump's fresh-checkout failure

## Problem

Under `registry` changelog storage, `version-management bump` parks each moved member's changelog at `<changelogDir>/<name with / as !>@<version>.md` (`memberChangelogPathOf`). Git tracks no empty directory, so a fresh checkout has no `changelogDir`. `ChangelogStoreLive.writeMemberChangelog` wrote through `overwriteTextFile`, which refuses a missing parent by design. Every bump that moved a member therefore failed with `ChangelogUnwritable ... reason=NotFound`, and the Release (dogfood) lane on `main` stayed red while CI and E2E were green.

## Failure mechanism

Every test that reached the parking write created the directory first:

1. `setupFixture` (the container E2E fixture) ran `mkdir -p` on the fixture repository's `changelogDir` while it built that repository.
2. The bump scenarios in `changesets.integration.test.ts` seeded a `.gitkeep` inside `changelogDir` in their temporary tree (seed removed by this fix).

Both suites ran bump against a tree that no real checkout has:

$$\text{test tree} = \text{checkout} \cup \{\texttt{changelogDir}\} \;\Rightarrow\; \text{suite green} \not\Rightarrow \text{lane green}$$

Removing only those two preconditions reproduced the lane's line in both suites. The integration scenarios returned `expected a bump, got ChangelogUnwritable`. The E2E phase "version step bumps surfaces, writes changelogs, consumes intents" failed its exit-code assertion.

## Fix

`writeMemberChangelog` now creates the parent before writing:

```ts
yield * ensureDirectory(fs, path.dirname(full)).pipe(
  Effect.andThen(overwriteTextFile(fs, full, text)),
  Effect.mapError(unwritable(entry.path)),
)
```

`ensureDirectory` is `fs.makeDirectory(full, { recursive: true })`, so it is a no-op when the directory exists and also creates a nested `changelogDir`. `overwriteTextFile` still refuses a missing parent for every other write. Manifests and surfaces must not invent directories, and only the parked changelog has a directory the tool owns. A `changelogDir` occupied by a regular file is still refused as `ChangelogUnwritable` at the parked path. The fix is pending in PR #58.

## Architectural invariant

**A fixture never creates state that the product owns.** If a fresh clone of a consumer repository lacks a path, and the product writes beneath it, the product creates the path and the test starts without it.

- wrong: a bump scenario seeds a `.gitkeep` inside `changelogDir` so the parked write has a parent.
- right: the bump scenario seeds only manifests and intents, and the scenario "A changelog directory several levels deep is created for the parked changelog" asserts that bump creates it.

Gate: review, backed by that scenario. It fails with `ChangelogUnwritable` on the pre-fix tree. The scenario "A changelog directory taken by a file is refused, naming the parked changelog" pins the refusal that remains.

Scope boundary: the `.gitkeep` seeds in `changelog-storage.integration.test.ts`, `release-tag.integration.test.ts` and the release-PR suites stay. Those scenarios model the tree after bump has run, where the directory exists.

## Related

- `docs/plans/2026-10-13-0732-fix-bump-parks-changelogs-in-a-fresh-dir-plan.md`
- `docs/solutions/workflow-issues/read-the-e2e-summary-artifact.md`
