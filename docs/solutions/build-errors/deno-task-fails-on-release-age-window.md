---
title: Every deno task fails when a pinned dependency sits inside the release-age window
date: 2026-09-10
category: build-errors
module: deno-workspace
problem_type: build_error
component: tooling
symptoms:
  - "Every `deno task` exits non-zero, including tasks unrelated to the offending package"
  - "The failure happens before the task body runs"
root_cause: config_error
resolution_type: dependency_update
severity: high
tags: [deno, deno-task, dependency-pinning, release-age]
---

# Every deno task fails when a pinned dependency sits inside the release-age window

## Problem

A task run failed at dependency resolution rather than in the task. The pin was `@effect/tsgo` at a version published inside Deno's minimum release age (24 hours by default; nothing in this repository overrides it). Because resolution precedes dispatch, every task in the workspace failed identically.

## Symptoms

- `deno task lint`, `deno task check` and `deno task format:check` all fail the same way.
- The error names an npm package and its resolved version; no task body output appears.

## What Didn't Work

- Editing the failing task: the task runner resolves the root npm graph before it spawns anything, so the body is never the variable — unrelated tasks fail identically.
- Relaxing the age policy: the policy protects every dependency from a too-fresh release, and one new pin does not justify removing it.

## Solution

Move the pin to a release older than the window, then prove the graph resolves:

```json
"devDependencies": {
  "@effect/tsgo": "0.44.0"
}
```

```bash
deno task lint   # any task proves the graph resolves; a resolution failure precedes the body
```

The root npm manifest pins 0.44.0 and the lockfile entry agrees; before the change the pin was 0.45.0.

## Why This Works

**Invariant — the root graph is a precondition of every task.** The workspace task runner resolves the entire root npm graph before dispatching any task, so a resolution failure is a total outage of the task interface rather than one task's failure:

$$\text{task runnable} \;=\; \text{root graph resolvable} \;\land\; \text{body exit 0}$$

The release-age window is a predicate over that graph, so a single too-fresh pin falsifies it for every task, whatever the task does.

**Invariant — a pin carries a publication-age constraint as well as a version.** Pinning a version pins its publication date. A bump therefore changes two things at once: which code runs, and whether the resolver will admit it at all.

## Prevention

- **Gate — exercise the task, not the binary:** after any dependency change, run a task (`deno task lint`). Only the task path resolves the root graph first; a direct invocation cannot surface this failure mode.
- **Gate — manifest and lockfile agree:** the version in the root npm manifest and the version in the lockfile entry must match; a mismatch means the graph that resolves is not the graph the manifest declares.
- **When a bump lands inside the window:** pin to the previous release and revisit it after the window passes, or delete the dependency surface entirely if nothing consumes it. Never widen or disable the age policy.
- **Anti-pattern to audit for:** a task body edited while the failure is a resolution error naming a package the body never touches.
