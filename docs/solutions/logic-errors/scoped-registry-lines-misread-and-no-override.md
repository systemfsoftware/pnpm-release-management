---
title: Scoped registry routing misread commented, quoted and repeated .npmrc lines, and a derivation src could not pass its routing
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

`registriesFromNpmrc` matched only a bare URL followed by whitespace. That broke three cases:

- A line ending in a `#` or `;` comment was dropped.
- A quoted URL kept its quotes.
- `listToAttrs` kept the first line for a scope, where npm keeps the last.

A caller whose `src` is a derivation could not pass the routing in at all, because its `.npmrc` cannot be read at evaluation time.

## Which .npmrc

The store's `pnpm install` runs at the root of `src`, so pnpm reads `src/.npmrc`, wherever the `lockFile` comes from. `mkPnpmWorkspacePackages` passes a cut-down `lockFile` with `src` unchanged. Reading the `.npmrc` beside the lockfile instead would have dropped that routing, and for a `builtins.toFile` or derivation lockfile it would have probed `/nix/store` or a build output at evaluation time. The routing source stays `src/.npmrc`.

## Fix

- A new `registries` argument replaces `src/.npmrc`'s lines.
- The parser follows npm's ini rules:
  - a value may be double- or single-quoted;
  - a comment starts at a `#` or `;` that follows whitespace, so a `#` inside a URL stays in the URL;
  - an empty value unsets the scope;
  - the last line for a scope wins;
  - an unclosed quote is skipped, never read as a URL;
  - a leading byte-order mark is ignored.

## Prevention

The `pnpm-lock-parser` check asserts each parser case. Its fixture `nix/sandbox/routed-workspace` keeps the lockfile in a subdirectory and the `.npmrc` at the root of `src`, and the check asserts the explicit `registries` override. The parser assertion fails on the previous parser.
