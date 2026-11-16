---
title: A release run reopened a release PR from its own, older commit after the release had merged
date: 2026-11-15
category: workflow-issues
module: release-workflow
problem_type: workflow_issue
component: development_workflow
symptoms:
  - "A second release PR opened about a minute after the first one merged, with the versions the first one had just released"
  - "The run on the merge commit reported phase=release and published, and the second release PR stayed open"
root_cause: race_condition
resolution_type: workflow_fix
severity: high
tags: [release-pr, version-job, actions-checkout, concurrency, bend]
---

# A release run reopened a release PR from its own, older commit after the release had merged

## Problem

A consumer merged a feature PR with intents, then merged its release PR 36 seconds later. The release run that the
feature merge started ran its `version` job after the release PR had merged. It bumped the already-released intents
again and pushed `changeset-release/main`, which opened a second release PR. The run that the release PR's merge
started found nothing pending, so `plan` reported `phase=release`: it tagged and published, and skipped `version`,
the only job that touches the release PR. The second release PR stayed open, offering versions that were already
released.

## Root cause

Two facts about `.github/workflows/release.yml`:

- The `version` job checked out the commit that started the run (actions/checkout's default, `github.sha`), not the
  default branch as it was when the job acted. The callers' concurrency group queues runs, and the job spends most of
  a minute building its tools, so the commit it versioned could be one a release PR had already superseded.
- The job ran only when `plan`, also on that commit, found intents pending (`phase=version`). No other run ever
  reconciled the release PR, so nothing closed one that had gone stale.

`github-release-management pr` already did the right thing on the right tree: with nothing pending and a release PR
open, it closes the PR and deletes the branch (`pullRequestCaseOf`, `Closing`). It was never run on that tree.

## Fix

The `plan` job now reconciles the release PR on every run after deriving the phase. It fetches the default branch and
resets onto its current head immediately before `bump` and `pr`. Its concurrency group, `release-pr-<repository>`,
prevents two runs from reconciling at once, including in callers that set no workflow-level group. `release` and
`publish` stay on the commit that started the run.

What remains is the time between the refetch and `pr`'s write. A release PR that merges inside that window can still
be reopened, and the next run, which that merge starts, closes it.

`release-pr/` holds a Bend 2 model of the job and of `pr`'s decision, with laws the kernel checks
(`nix develop --command sh -c 'cd release-pr && bend PROOF.bend --verdict'`):

- after every sequence of merges and version-job steps, a stale release PR implies a run is still owed;
- once no run is owed, the open release PR is exactly the one the default branch's head asks for;
- the old job reproduces this incident (L5), the fixed job closes it (L6), and the remaining window closes on the
  next run (L7, L8).

The proof holds under the assumptions stated in `LAWS.bend`. The main one is that every merge starts a release run.

## Prevention

- A step that writes shared state (a branch, a pull request, a tag) decides from that state as it is when it writes,
  never from the commit that started the run. A queued run's event commit can be minutes older than the branch.
- Every outcome of a reconciling command is reachable from the runs that invoke it. Here closing was reachable only
  from a run that had found work to do.
- Before changing version reconciliation or `pr`'s decision, change `release-pr/main.bend` to match and run
  `bend PROOF.bend --verdict`. A model that no longer matches the YAML proves nothing.
