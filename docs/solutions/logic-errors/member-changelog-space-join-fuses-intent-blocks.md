---
title: Joining intent summaries with a space fuses markdown blocks in a member changelog
date: 2026-11-01
category: logic-errors
module: changesets-adapter
problem_type: logic_error
component: service_layer
symptoms:
  - "The consumer's `dprint check` exits 0 before `version-management bump` and exits 20 after it, naming member changelogs it wants to reformat"
  - "A member changelog line holds the last sentence of one intent followed by `- ` and the first bullet of the next intent"
  - "The release pull request fails the consumer's format check although no hand-written file changed"
root_cause: logic_error
resolution_type: code_fix
severity: high
tags: [changelog, markdown, intents, dprint, format-check, bump, changesets-strategy]
related_components:
  - packages/version-engine
  - packages/workspace-adapter
---

# Joining intent summaries with a space fuses markdown blocks in a member changelog

## Problem

An intent body is markdown with its own block structure: paragraphs, lists, code. Under the `changesets` strategy, `projectPlan` set a member's release summary to the intent summaries joined with one space, and `bump` wrote that string as the member changelog entry through `plannedSummaryOf`. When a later intent began with a bullet list, its first `-` marker landed mid-line after the previous intent's last sentence. The consumer's markdown formatter then wanted a blank line and a line break there, so every release pull request that consumed such a pair failed `check:ci` at the format step.

The failure appears only when intents mix prose and lists; a set of single-paragraph intents never exposes it.

## Mechanism

1. An intent file is read as a body of several lines. `parseIntent` trims every line, drops blanks and joins with a space, so the `Intent.summary` the `surfaces` path consumes is one flat line per intent.
2. The `changesets` path does not use that flat form. It takes each intent's raw summary from the changesets assembly in `ChangesetsPortLive`, so multi-line bodies reach `projectPlan` intact.
3. `projectPlan` joined those bodies with `' '`. A body ending in the sentence "...is an optional peer dependency." followed by a body whose first line was a `-` bullet became one line, with the bullet marker in the middle of the sentence.
4. `writeMemberChangelog` wrote the result unchanged under both `registry` storage (a parked file per release) and `repository` storage (a section in the member's own `CHANGELOG.md`).
5. A formatter parses markdown. A `-` that is not at the start of a line is plain text, so the join changed block structure, not just spacing.

Let $b_i$ be the blocks of intent $i$. A correct changelog preserves block boundaries:

$$\text{blocks}(\text{join}(s_1, s_2)) = \text{blocks}(s_1) \cup \text{blocks}(s_2)$$

A space join gives $\text{blocks}(s_1 \,\|\, \text{' '} \,\|\, s_2) = \text{blocks}(s_1 \,\|\, s_2)$ with the last paragraph of $s_1$ extended by the first line of $s_2$. That is false whenever $s_2$ starts a block of its own.

## What Didn't Work

- Copying `@changesets/changelog-git`: its `getReleaseLine` prefixes the first line of each release line with a `-` marker and indents the remaining lines by two spaces. Written as is, that output is not stable under the consumer's formatter. A nested list fails: the formatter wants the bare marker and the indented items split apart. changesets' own pipeline runs a formatter pass after writing, and this engine writes the file as is, so it cannot lean on that pass.
- Reading the problem as one more instance of the root-changelog bullet bug (PR #64). That fix concerned the indentation of `rootBulletsOf` and does not touch a member's summary, which has a different producer.

## Solution

Join the summaries as separate markdown blocks: trim each, drop the empty ones, separate with one blank line.

```ts
const joinAsMarkdownBlocks = (summaries: ReadonlyArray<string>): string =>
  summaries.map((text) => text.trim()).filter((text) => text !== '').join('\n\n')
```

`projectPlan` uses it in place of `own.join(' ')`. The fallback for a member with no own intent (`dependencyLineOf`) is unchanged.

## Why This Works

A blank line is the markdown block separator, so each intent stays a block sequence of its own, and no intent can swallow the line that follows it. Blocks start at column 0, which is the form the consumer's formatter writes back, so the output is a fixed point of the format check:

$$\text{format}(\text{changelog}) = \text{changelog}$$

## Architectural Invariants

**A summary is a markdown value. Concatenating markdown values joins them at block boundaries, never inline.**

- Wrong: `intents.map(summaryOf).join(' ')` for text that came from a multi-line body.
- Right: `intents.map(summaryOf).map(trim).filter(nonEmpty).join('\n\n')`.

Anti-pattern smell to grep for: a `.join(' ')` whose elements are intent or release summaries.

Known remaining sites, deliberately not changed by the fix above and carrying the same smell:

- `parseIntent` flattens the body of an intent into one line before it becomes `Intent.summary`.
- `summaryForPackage` and `fallbackSummaryOf` join intent summaries with a space on the `surfaces` strategy.
- `rootBulletsOf` is safe only because `parseIntent` has already flattened each summary to one line. A list inside an intent fuses into its bullet there.

If any of these starts receiving multi-line summaries, the flattening in `parseIntent` is the guard that must change first.

## Prevention

- Judge the written file with the consumer's own formatter, not with a string assertion. The feature `Release notes in a member changelog pass the repository format check` (`member-changelog-format.integration.test.ts`) runs the real `bumpCell` over the real workspace stores and calls the repository's `dprint check` on the member changelog. It runs under both `registry` and `repository` storage. All three rows fail with the space join and pass with the block join. A dprint-accepting file that lost its blank line would still pass a prose-contains check, which is why the formatter is the judge.
- Cover the shape that triggers it: one intent of two paragraphs, one intent that is a list, and the order list-then-paragraph. A single-paragraph intent never fails.
- To reproduce against a consumer, run the built `version-management bump` in an untouched copy and run its format check before and after. Under a container whose pnpm is older than the consumer's pinned `packageManager`, pnpm tries to switch versions and `bump` fails with `ManifestUnreadable` at the workspace root. Setting `pnpm_config_pm_on_fail=ignore` in the environment of the run avoids that without editing the copy.

## Related

- `docs/solutions/runtime-errors/fixture-seeded-directory-hid-fresh-checkout-bump-failure.md`
- `docs/solutions/runtime-errors/pnpm-root-importer-row-fails-member-enumeration.md`
