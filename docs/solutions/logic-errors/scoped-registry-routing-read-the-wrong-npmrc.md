---
title: Scoped registry routing read the .npmrc beside src, not beside the lockfile, and misread commented or quoted lines
date: 2026-11-24
category: logic-errors
module: nix-pnpm-store
problem_type: logic_error
component: development_workflow
symptoms:
  - "A scoped package's tarball URL pointed at registry.npmjs.org and the fixed-output fetch answered 404"
root_cause: logic_error
resolution_type: code_fix
severity: medium
tags: [nix, pnpm, npmrc, registry, mitm-cache]
---

## Problem

`pnpm-store.nix` took the scope-to-registry routing from `src + "/.npmrc"`. pnpm reads the `.npmrc` that sits beside the lockfile. So when a caller's lockfile was in a subdirectory, the routing came out empty, and the scoped package was fetched from the public registry. A caller whose `src` is a derivation also had no way to pass the routing in.

`registriesFromNpmrc` matched only a bare URL followed by whitespace. That broke three cases:

- A line ending in a `#` or `;` comment was dropped.
- A quoted URL kept its quotes.
- `listToAttrs` kept the first line for a scope, where npm and pnpm keep the last.

## Fix

- The store reads the `.npmrc` at `dirOf lockFile`.
- A new `registries` argument overrides that file.
- The parser takes double-quoted, single-quoted or bare values, ends a bare value at `#` or `;`, and folds the lines left to right, so the last line for a scope wins.

## Prevention

The `pnpm-lock-parser` check holds an assertion for each case:

- a commented line;
- a double-quoted line;
- a single-quoted line;
- a repeated scope;
- a lockfile in a subdirectory with its own `.npmrc` (fixture `nix/sandbox/routed-workspace`);
- an explicit `registries` argument.

Each assertion fails on the previous code.
