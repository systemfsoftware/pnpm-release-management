---
title: Keep sandbox pnpm opt-in when callPackage injects named arguments
date: 2026-11-04
category: integration-issues
module: sandbox
problem_type: integration_issue
component: development_workflow
symptoms:
  - "Corepack fails with EAI_AGAIN for registry.npmjs.org inside the network-isolated sandbox"
  - "The sandbox refuses a workspace pin because the pnpm on PATH has another minor version"
root_cause: config_error
resolution_type: code_fix
severity: high
tags: [nix, callpackage, pnpm, sandbox, offline, path, version-pinning]
---

# Keep sandbox pnpm opt-in when callPackage injects named arguments

## Problem

The sandbox runs commands without network access. A caller whose PATH resolves `pnpm` to an uncached corepack shim can cause a registry download inside that isolation boundary. Giving every sandbox one fixed pnpm instead breaks consumers pinned to other minors: the sandbox's existing version guard rejects them before executing their command.

## Symptoms

- A sandboxed hook fails with `EAI_AGAIN registry.npmjs.org` when corepack tries to obtain pnpm.
- A workspace pinned to pnpm 11.27 rejects a sandbox-provided pnpm 12.9 with exit code 2, even when the caller has the pinned version on PATH.

## What Didn't Work

- **Bundle one pnpm unconditionally.** The wrapper puts its runtime inputs ahead of the caller's PATH. A single pnpm therefore takes precedence for every consumer, including consumers with incompatible major/minor pins. The sandbox guard intentionally compares major and minor, not only the major.
- **Declare `pnpm ? null` as a named top-level argument to a `callPackage` function.** The pinned package set contains `pnpm`, so `callPackage` supplies it even when the caller did not request it. The apparent null default does not preserve the existing sandbox.
- **Run the proof package via `nix shell` and treat its PATH as neutral.** The proof package refers to its outsider store path; putting the package itself on PATH causes the sandbox to include that path's closure, invalidating the isolation proof. Run the built proof executable directly instead.

## Solution

The sandbox package accepts extra arguments without listing `pnpm` among the names `callPackage` auto-fills. It reads the optional value and adds it only when non-null:

```nix
args@{ lib, writeShellApplication, coreutils, git, ... }:
let
  pnpm = args.pnpm or null;
in
writeShellApplication {
  name = "sandbox";
  runtimeInputs = [ coreutils git ] ++ lib.optional (pnpm != null) pnpm;
  # Other runtime substitutions and application text omitted.
}
```

A consumer that needs an offline pnpm opts in explicitly:

```nix
sandbox.override { pnpm = pkgs.pnpm_12; }
```

The default still uses the caller's PATH; it does **not** guarantee an offline pnpm. The override supplies the chosen executable, not arbitrary workspace dependencies: offline installs still require a suitable pnpm store. The implementation is in PR #77, open as of this writing.

## Why This Works

**Selection invariant:** the pnpm checked before isolation and the pnpm invoked inside the sandbox must be the same executable, and its major/minor must match the consumer's pin. Opting in prepends the consumer's chosen pnpm to the wrapper PATH; the sandbox uses that PATH for its check and passes it into the isolated environment. The sandbox also derives its readable Nix closure from PATH, making the selected executable available inside.

**Compatibility invariant:** absence of an explicit override must preserve the original package and caller-selected PATH. An argument set with `...` keeps `pnpm` out of `callPackage`'s automatically supplied named arguments while allowing `.override` to pass it explicitly.

## Prevention

- Verify the default derivation against the baseline and run it with a caller-supplied pnpm matching the workspace pin.
- Run an overridden sandbox with a conflicting caller pnpm; confirm the override wins, then confirm the existing major/minor guard still rejects an incompatible workspace pin.
- Run the existing sandbox proofs from the built executable without putting the proof derivation on PATH; include the offline store install and outsider-closure checks.
- Avoid describing the default as offline-safe: only an explicit local pnpm selection prevents corepack from being selected by the caller's PATH.

## Related Issues

- Related to SYS-1110.
- `docs/solutions/workflow-issues/install-free-check-still-needs-its-tools-on-path.md` covers the distinct failure where a caller omits a spawned tool entirely.
