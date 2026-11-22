---
title: The intent gate read a branch name instead of the change, so a queued release PR failed
date: 2026-11-22
category: logic-errors
module: gateChanges, ChangeEvidenceLive
problem_type: logic_error
component: release
severity: high
symptoms:
  - A release PR passes the intent check on its own head branch and fails the same check on a merge-queue draft branch
  - 'The queued run reports: This change moves 1 publishable package(s) that no intent names'
  - The release PR consumes its intents by deleting them, so the post-bump tree has no intent on disk
tags:
  - changesets
  - merge-queue
  - change-intent
  - gate
---

# The intent gate read a branch name instead of the change, so a queued release PR failed

## Problem

The intent check exempted the release PR by branch name: the reusable check workflow skipped its job when `github.head_ref` was `changeset-release/main`, and callers gated the call with the same test. A merge queue tests a queued pull request on a draft branch, so the head ref is the queue's branch, not the release branch. The check ran, read the release diff, and refused it: every publishable package that `changeset version` bumped moved with no intent on disk, because consuming an intent deletes it.

The refusal is correct for the tree it sees and wrong for the change it means. The exemption was compensating for a decision that could not read a consumed intent, so it only worked while the head ref happened to name the release branch.

## Cause

`gateChanges` classified a package as named when a live intent in `.changeset/` named it. `ChangeEvidenceLive` reported only the packages touched and deleted, not which files changed nor which intents the change deleted, so the decider had no way to see a consumed intent. The release-shaped diff is exactly three moves per package: delete `.changeset/<slug>.md`, bump the package manifest version, prepend a changelog section. None of those is a live intent.

The branch-name exemption hid this: on `changeset-release/main` the job never ran, so the gate's blind spot never surfaced. Any other branch name — a merge-queue draft, a renamed release branch, a manual rerun — runs the gate and fails on a diff that is its own intent.

## Fix

Evidence now carries the change, not a summary of it:

- `ChangeEvidence` gains `changed`, every path the diff touched, and `consumed`, the intents read from the deleted changeset files at the merge-base.
- `consumedIntentsAt` reads a deleted `.changeset/*.md` at the merge-base and parses it with the same `parseIntentDocument` the changeset store uses for live intents, so one reader owns the document format.
- `gateChanges` accepts a moved publishable package when either a live intent names it, as before, or a consumed intent releases it and every changed file owned by the package is its manifest or its changelog.
- A consumed intent with a `none` bump releases nothing and does not explain a version move; a source edit alongside a bump is not the version-bump shape and still needs a live intent.
- The reusable check workflow drops the branch-name exemption because the decision no longer needs one.

## Architectural invariants

1. **Classify by the change, never by the branch.** A check that runs on a pull request must decide from the diff and the tree it can read. A branch name is an input the queue rewrites.
2. **Consumption is evidence.** Deleting an intent is the act that consumes it. A gate that reads only live intents cannot see a completed release cycle, so the evidence port must report deleted intent documents alongside deleted manifests.
3. **Shape limits the excuse.** A consumed intent explains a version bump and a changelog entry, nothing else. The file-kind check keeps the exemption from becoming a license to ship source under a deleted changeset.

## Evidence

The regression test builds a real repository, commits a release-shaped diff (deleted intent, manifest bump, changelog section) and a real unexplained move (manifest bump with no intent), and runs `gateChanges` through `ChangeEvidenceLive` with real git reads. Against the pre-fix decider the release-shaped case is refused; with the fix it passes, while the unexplained move and a bump that also edits a source file are still refused.

## Prevention

- An exemption keyed on an identifier the environment rewrites (a branch name, a label, a workflow name) is a symptom patch. Find the fact the decision lacks and put it in the evidence.
- A gate that reads repository state should be exercised on the artifact a real release produces, not only on hand-written fakes.
- Test the negative shape with the same fixture as the positive one: the same diff minus the consumed intent must still be refused.
