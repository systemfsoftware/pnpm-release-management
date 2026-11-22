---
title: The intent gate read a branch name instead of the change, so a queued release PR failed
date: 2026-11-22
category: logic-errors
module: gateChanges, ChangeEvidenceLive, ReleaseReplayLive
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
  - replay
---

# The intent gate read a branch name instead of the change, so a queued release PR failed

## Problem

The intent check exempted the release PR by branch name: the reusable check workflow skipped its job when `github.head_ref` was `changeset-release/main`. A merge queue tests a queued pull request on a draft branch (`mergify/merge-queue/<id>`), so the head ref is the queue's branch, not the release branch. The check ran, read the release diff, and refused it: every package `version bump` moved had no intent on disk, because consuming an intent deletes it. The public consumer `systemfsoftware/timescale-drizzle` hit this on PR #32.

The refusal was correct for the tree it saw and wrong for the change it meant. The exemption compensated for a decision that could not read a consumed intent, so it only worked while the head ref happened to name the release branch.

## Why a shape rule is not enough

The first fix (PR #124) taught the gate to accept a moved package when a deleted intent named it and the package's changed files were only its manifest and changelog. An adversarial review found that a file-kind rule still lets a non-release change through or blocks a real one:

- A manifest edit (a `bin` entry, a dependency) rides in the "manifest" slot of a release-shaped diff.
- A commit can delete an intent for two packages and bump only one, dropping the sibling's release.
- A non-release PR can delete a queued intent and edit the manifest itself.
- A batched queue draft holds a feature PR and the release PR touching one package, so the per-package file kinds mix.
- Under turbo, a dependent whose hash moved only because its dependency did owns no changed file at all.

Every one of these is a question about what the bump would have written, which a path heuristic cannot answer.

## Fix

The gate re-derives each release commit instead of recognising its shape.

- The evidence port reports git facts, not verdicts: the range (merge base computed once from `HEAD`'s sha), each commit in `rev-list H ^B` with its own changes, and for a merge the residue it adds beyond `git merge-tree` of its parents.
- A commit that only deletes merge-base intents is a release candidate. The check checks out its parent in a temporary worktree, sets aside the intents it did not delete, runs the same bump in-process, stages the result as `release pr` stages its commit, and compares trees. An exact match is a verified release; any difference refuses and names the paths.
- A path is release-owned only when verified releases touch it and no other commit or merge residue does. Everything else is a feature change and needs a live intent for the package that owns it.
- Intent edits are judged by conservation: each package keeps at least the highest bump that the merge-base intents changed here still owed it. Splitting, merging, moving and rewriting pass; dropping or downgrading refuses.
- A release cut from a base that has since changed a release surface is stale and refused, since its replay started from a tree the base no longer has.
- The workflow drops the branch-name exemption.

## Architectural invariants

1. **Classify by the change, never by the branch.** A branch name is an input the queue rewrites.
2. **Verify a generated commit by regenerating it.** When a commit claims to be the output of a deterministic tool, run the tool from the commit's parent and compare trees. The replay is the oracle; a description of the output's shape is not.
3. **Ownership fails closed.** A path the release commits did not exclusively produce is a feature change.

## Prevention

- An exemption keyed on an identifier the environment rewrites (a branch name, a label, a workflow name) is a symptom patch. Find the fact the decision lacks and put it in the evidence.
- Exercise a gate on the artifact a real release produces: the integration tests commit the output of the real bump and run the built CLI on a `mergify/merge-queue/<id>` branch, and the same fixture minus one fact (a smuggled `bin`, a missing feature intent) must refuse.
- The release workflow and the check build their tools at their own revisions. A bump that changes its output between those revisions makes the replay diverge, which refuses rather than passes.
