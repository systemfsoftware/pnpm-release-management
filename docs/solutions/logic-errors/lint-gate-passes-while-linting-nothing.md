---
title: A lint gate can pass while linting nothing
date: 2026-09-10
category: logic-errors
module: oxlint-gate
problem_type: logic_error
component: tooling
symptoms:
  - "`deno task lint:core` exits 0 while a deliberately broken file in its scope reports nothing"
  - "A target list built from `git ls-files` lints zero files before the first commit and still exits 0"
  - "An `ignorePatterns` entry left from an earlier layout silently excluded every core file"
root_cause: config_error
resolution_type: config_change
severity: high
tags: [oxlint, lint-gate, ignore-patterns, git-ls-files, silent-pass]
---

# A lint gate can pass while linting nothing

## Problem

Two independent ways the oxlint gate reported success while examining nothing. First, an ignore pattern covering the core source directories — left over from the pre-rebuild layout — excluded every core file. Second, a target list produced by `git ls-files` is empty in a repository with no commits, which is the state of a fresh container or a fixture workspace. Both exit 0, so both are indistinguishable from a clean run.

## Symptoms

- `deno task lint:core` exits 0 while a known-bad file inside its scope reports nothing.
- Zero findings and zero linted files produce identical output.
- The gate passes in CI while a banned construct remains committed.

## What Didn't Work

- Trusting the exit code: both failure modes return 0.
- Reviewing the config by eye: an over-broad ignore pattern is indistinguishable from a correct one until something in scope is deliberately broken.
- Reading the finding count as coverage: a count of 0 is also what an empty target list produces.

## Solution

Select targets from the working tree with globs the shell expands; ignore only what is genuinely not source:

```
lint:core  ->  sh -c 'deno run --allow-all npm:oxlint
                 apps/*/*.schema.ts apps/*/*.workflow.ts
                 packages/*/src/*.schema.ts packages/*/src/*.workflow.ts
                 --config oxlint.config.ts'

ignorePatterns: ['e2e/**', 'bin/**']
```

## Why This Works

**Invariant — working-tree selection, never index selection.** A glob expanded by the same shell that spawns the linter is empty only when the tree is. An index query (`git ls-files`) is empty whenever the index is, regardless of the tree — so the gate's target list must never be produced by a tool that reads the git index.

**Invariant — an ignore list is a disable switch and may name only non-source.** Any ignore entry whose subtree holds linted sources disables the gate for that subtree with no output. Its blast radius is the whole subtree, so it must be justified entry by entry.

**Invariant — a green gate asserts three independent conditions.** The gate is honest only when (a) the target list is non-empty, (b) the ignore list excludes no source, and (c) the type-check configuration's include set covers the target list — because the type-aware half of the rules is inert, not failing, when no type information covers a file. The `@systemfsoftware/all` preset states this: type-aware rules need a configuration that includes the files being linted, and "half of these rules produce no diagnostics without it and say nothing about being inert."

## Prevention

- **Gate — negative control (the only proof the gate is wired):** introduce one construct the configuration bans into a covered file, confirm `deno task lint:core` exits non-zero, then remove it. An error-level rule at hand is `no-restricted-imports`, which forbids importing Node.js builtins — the preset's message reads "Importing Node.js builtins via \"node:\" is forbidden — use \"@effect/platform\" or a Web Standard API". A gate never observed failing is not known to be connected.
- **Gate — non-empty target list:** expand the task's globs and count them.
  `sh -c 'printf "%s\n" apps/*/*.schema.ts apps/*/*.workflow.ts packages/*/src/*.schema.ts packages/*/src/*.workflow.ts' | wc -l` printed 37 in this repository. `0` is the failure.
- **Gate — index independence:** never select lint targets with `git ls-files`; in a freshly initialised repository it returns nothing (`git ls-files | wc -l` printed 0 against an empty repository) and the gate passes vacuously.
- **Anti-pattern to audit for:** an `ignorePatterns` entry whose subtree contains linted sources, and any target list produced by a tool that reads the git index.

## Related Issues

- `docs/solutions/build-errors/deno-only-member-invisible-to-node-resolvers.md` — the same silent-inertness class, on module resolution rather than file selection.
