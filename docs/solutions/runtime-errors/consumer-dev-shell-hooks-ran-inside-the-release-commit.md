---
title: Consumer dev-shell hooks ran inside the release commit and refused the release PR
date: 2026-11-02
category: runtime-errors
module: git-adapter
problem_type: runtime_error
component: service_layer
symptoms:
  - "The Release version phase refuses with `PullRequestGitFailed` naming the release `git commit -m chore(release): version packages`"
  - "The release PR never opens or updates on a consumer whose dev shell sets `core.hooksPath .husky`, while consumers without it keep passing"
root_cause: config_error
resolution_type: code_fix
severity: high
tags: [git-hooks, core-hookspath, husky, release-pr, no-verify, consumer-shell]
related_components:
  - packages/github-release-engine
---

# Consumer dev-shell hooks ran inside the release commit and refused the release PR

## Problem

The release tool's version phase runs inside a consumer's nix dev shell whose `shellHook` points `core.hooksPath` at the consumer's own husky directory (the reported SYS-956 incident). The release commit then executed the consumer's pre-commit and commit-msg hooks, which need a workspace install the version job never performs, so `git commit` aborted, `PullRequestGitFailed` refused the run, and the release PR never opened.

## Symptoms

- The version phase refuses: `::error::git command failed: git -c user.name=github-actions[bot] … commit -m chore(release): version packages`, with the consumer hook's stderr beneath.
- The release PR is missing on exactly the consumers the workflow exists for; a checkout without `core.hooksPath` pointing at failing hook scripts does not reproduce it.

## What Didn't Work

- `--no-verify` — rejected by contract: git-commit(1) scopes it to the pre-commit and commit-msg hooks. A consumer's prepare-commit-msg would still run — consumers ship one that rewrites the commit-message file — and every push would stay exposed to the consumer's pre-push hook.
- The pre-fix suite stayed green because no fixture set `core.hooksPath` (historical; the current suite's consumer-hooks scenario closes that gap). The leak existed only where a consumer's config put it. This is the fixture-versus-checkout gap `docs/solutions/workflow-issues/prove-a-bump-fix-on-real-consumer-checkouts.md` documents.

## Solution

`GitLive` prefixes the four release invocations whose failure modes include a consumer hook — the commit in `commitRelease` and the pushes in `pushBranch`, `deleteRemoteBranch` and `pushTags` — with a per-invocation config override, held in the `RELEASE_HOOKS_OFF` constant:

```ts
const RELEASE_HOOKS_OFF: ReadonlyArray<string> = ['-c', 'core.hooksPath=/dev/null']
```

```ts
// commitRelease
yield * step([...RELEASE_BOT_IDENTITY, ...RELEASE_HOOKS_OFF, 'commit', '-m', message])
// pushBranch
const args = [...RELEASE_HOOKS_OFF, 'push', '--force', remote, `HEAD:refs/heads/${branch}`]
// deleteRemoteBranch and pushTags: the same prefix on their `git push` argv
```

The consumer's repository config is never modified — the override lives only on the invocation's argv, so a human commit in the same checkout still runs the consumer's hooks exactly as before. Other release git operations stay bare: they can still surface non-verify hooks (`post-index-change` after `commitRelease`'s index writes; `reference-transaction` fires on any ref update, including annotated tag creation in `writeTag`), and a consumer shipping a reference-transaction hook could in principle abort one of those — no such consumer appeared in the field failures, which were verify-class (pre-commit, commit-msg) plus pre-push.

## Why This Works

git-config(1) resolves every hook as a file under `core.hooksPath`; a non-directory path makes each lookup miss, so no hook of any type runs for that invocation. One override covers every hook the two operations can fire — commit fires pre-commit, prepare-commit-msg, commit-msg, post-commit and reference-transaction on its ref update; push fires pre-push client-side — where `--no-verify` covers a documented subset of one operation.

**Invariant — a bot operation names its own config; it never inherits the tree's.** The release tool executes inside a shell the consumer provisioned for human work. Whatever that shell mutates in repository config (hook paths, identity) is human-workflow state. Automation passes its semantics explicitly per invocation (`-c key=value`) instead of consuming what the environment left behind.

**Invariant — bypass flags are named-subset flags; config overrides are total.** Prefer the mechanism whose guarantee is "no hook resolves" over one whose guarantee is "these named hooks are skipped": the named set changes whenever git grows a hook type, and a message-mutating hook between the named ones silently corrupts the bot's output.

## Prevention

- **Gate — the fixture reproduces it:** the scenario "Consumer hooksPath hooks that exit 1 do not stop the release commit" in the release-pull-request integration suite wires `core.hooksPath .husky` with pre-commit, commit-msg and pre-push exiting 1 plus a prepare-commit-msg that appends a trailer, then asserts the release commit lands with the exact title and the release bot identity. The message-purity assertion is what pins the `--no-verify` rejection.
- **Audit rule:** the four hook-failing release invocations (the `commitRelease` commit and the three pushes) carry `RELEASE_HOOKS_OFF`. `writeTag`'s annotated `git tag` stays bare — it fires no verify-class hook, but creating a tag updates a reference, so a consumer shipping a reference-transaction hook could abort it; add the override there if such a consumer appears. Pure reads (`rev-parse`, `ls-remote`) stay bare.
- **Consumer-level proof:** the SYS-956 verification applied the consumer-checkout principle of `docs/solutions/workflow-issues/prove-a-bump-fix-on-real-consumer-checkouts.md` to this fix: run the release commit on an untouched consumer checkout with its hooks wired and failing — the refusal names itself only there.

## Related Issues

- `docs/solutions/workflow-issues/install-free-check-still-needs-its-tools-on-path.md` — the ambient-environment contrast: install-free does not mean the subprocess environment is free of consumer state.
- `docs/solutions/workflow-issues/prove-a-bump-fix-on-real-consumer-checkouts.md`
- `docs/solutions/runtime-errors/fixture-seeded-directory-hid-fresh-checkout-bump-failure.md` — the fixture-versus-checkout gap, for a missing directory.
