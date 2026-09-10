---
title: A member with only the workspace identity is invisible to node-resolving type-aware tooling
date: 2026-09-10
category: build-errors
module: release-language
problem_type: build_error
component: tooling
symptoms:
  - "`deno task lint:core` reports several hundred `no-unsafe-*` findings on correct code"
  - "`deno task lint:tsgo` reports one error per identifier whose type crosses the member"
  - "`deno check` is green over the same files"
root_cause: incomplete_setup
resolution_type: config_change
severity: high
tags: [deno, oxlint, tsgo, workspace-member, node-resolution]
---

# A member with only the workspace identity is invisible to node-resolving type-aware tooling

## Problem

Type-aware tooling flagged correct code: every value whose type crossed into the `@systemfsoftware/release-language` member read as `error`, so oxlint's type-aware rules reported an unsafe value at every use. Observed during the toolchain rebuild: 463 `no-unsafe-*` findings repo-wide before the fix, 0 after. `deno check` stayed green throughout, so the code was never in question — resolution was.

## Symptoms

- `deno task lint:core` reports several hundred `no-unsafe-*` findings.
- `deno task lint:tsgo` reports one error per identifier whose type crosses the member.
- `deno check` reports nothing over the same files.

## What Didn't Work

- Delivering the npm manifest without re-running `deno install`: the manifest supplies the member's npm identity, but node-style resolution follows the workspace link, and only the install step materialises it. The findings persist until the link exists.
- Reading `deno check`'s green as coverage: it resolves through the Deno workspace configuration, which sees a member that npm-style resolution cannot. Its green is not counter-evidence.

## Solution

Give the member an npm identity beside its workspace identity, then re-materialise the workspace link:

```json
{
  "name": "@systemfsoftware/release-language",
  "version": "0.0.0",
  "type": "module",
  "exports": { ".": "./mod.ts" }
}
```

```bash
deno install
readlink node_modules/@systemfsoftware/release-language   # -> the member directory
```

## Why This Works

**Invariant — dual identity for a type-crossing member.** A member whose types appear in another file's checked surface must be resolvable by _both_ resolvers in play: the workspace's own resolver (which reads the workspace configuration) and node-style resolution (which reads npm manifests and the link layer). A member carrying only the workspace identity is invisible to the second, so the specifier degrades to `error` and every rule that inspects an imported type reports an unsafe value.

**Invariant — checks agree only when they share the resolver.** Two checks over the same file list agree only when they resolve through the same identity. Here they disagree precisely because one resolves through the workspace configuration and the other through npm-style resolution. The disagreement is the signal; the file list was never the variable.

One manifest cleared all 463 findings because the type-aware pass runs over a fixed file list whose only workspace-member import is this one:

```bash
sh -c 'printf "%s\n" packages/*/src/*.schema.ts packages/*/src/*.workflow.ts' \
  | xargs grep -ho "from '@systemfsoftware/[a-z-]*'" | sort -u
# from '@systemfsoftware/effect-cell-types'   (npm dependency, already linked)
# from '@systemfsoftware/release-language'    (the member that needed the manifest)
```

## Prevention

- **Gate — the link exists:** `readlink node_modules/@systemfsoftware/release-language` prints the member directory. A fix that adds the manifest without re-running `deno install` fails this gate.
- **Gate — the specifier resolves:** `deno task lint:core` reports zero `no-unsafe-*` findings and `deno task lint:tsgo` exits 0.
- **Gate — the target list is covered:** the type-aware rules are inert rather than failing when no type-check configuration covers the linted files; the `@systemfsoftware/all` preset documents this ("half of these rules produce no diagnostics without it and say nothing about being inert"). A green type-aware gate therefore also asserts that the type-check configuration's include set covers the lint target list.
- **Anti-pattern to audit for:** a member that another member imports by specifier while carrying no npm manifest.

## Related Issues

- `docs/solutions/logic-errors/lint-gate-passes-while-linting-nothing.md` — the same silent-inertness class, on file selection rather than resolution.
