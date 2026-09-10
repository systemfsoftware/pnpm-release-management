---
title: The workspace root's own importer row breaks member enumeration
date: 2026-09-10
category: runtime-errors
module: workspace-adapter
problem_type: runtime_error
component: service_layer
symptoms:
  - "Every command that enumerates members fails with `ManifestInvalid`"
  - "The `ManifestInvalid` path names the repository root rather than a member directory"
root_cause: missing_validation
resolution_type: code_fix
severity: critical
tags: [pnpm, workspace, relative-path, brand, member-enumeration]
---

# The workspace root's own importer row breaks member enumeration

## Problem

Member enumeration runs a recursive package-manager listing and decodes each row's `path` relative to the repository root. A recursive listing also reports the repository root itself as an importer row, and that row's `path` is the root — so its relative directory is the empty string. The `RelativePath` brand requires at least one non-space character (`/^(?![/])(?!\s*$).+/`), so the decode fails and enumeration dies. Because enumeration is shared, every command that needs the member list — gate, plan, version bump, publish — fails on startup.

## Symptoms

- `ManifestInvalid` whose path is the repository root, not a member directory.
- A publishable-change gate, a release plan, a version bump and a publish all fail before doing any work.
- The failure is total rather than per-command: it lives in the shared enumeration, not in the commands.

## What Didn't Work

- Widening `RelativePath` to admit the empty string. The empty string is not a path, and admitting it would let the decoder emit a `Member` whose directory is the root; reading that member's manifest would then read the root manifest and offer the repository itself as a member. The brand is correct — the row is what must be rejected.
- Treating the row as malformed tool output: the listing behaves as specified; the consumer assumed every row is a member.

## Solution

Reject the root row before branding its directory. In `WorkspaceStore.listMembers`:

```ts
const dir = relative(root, rawPath)
if (dir === '') continue
```

## Why This Works

**Invariant — filter the collection before branding its parts.** A recursive listing's row set is the members plus the root; a row's directory is branded only after it is proven to be a member's directory. Equivalently:

$$\text{members} = \{\, \text{row} \in \text{rows} \;:\; \operatorname{relative}(\text{root}, \text{row.path}) \neq \epsilon \,\}$$

A branded type must only be applied to values the predicate has already accepted. Applying it first and repairing afterwards is what turned one foreign row into a total outage.

**Invariant — the brand's strictness is the reason to fix the input, not the brand.** The stricter the downstream type, the more the boundary is obliged to filter rather than relax the type. Every relaxation of a brand to accommodate one caller's malformed input makes a wrong value constructible everywhere.

## Prevention

- **Gate — the fixture reproduces it:** the e2e fixture builds a multi-member workspace with its own root manifest, so the root row is present in every phase and the first phase exercises enumeration through the publishable-change gate. Read the run's summary artifact for the verdict.
- **Gate — inspect the row set's shape:** inside any pnpm workspace, `pnpm ls -r --json --depth=-1 | jq -r '.[].path'` prints the repository root among the member paths. A consumer that treats every row as a member is one row away from this failure.
- **Anti-pattern to audit for:** a decoder mapped over a tool's recursive output before the output has been filtered to the set the decoder's type describes.

## Related Issues

- `docs/solutions/workflow-issues/read-the-e2e-summary-artifact.md` — where the fixture's verdict is read.
