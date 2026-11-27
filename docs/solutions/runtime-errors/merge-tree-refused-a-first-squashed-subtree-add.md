---
title: A first squashed subtree add crashed the changeset check at merge-tree
date: 2026-11-27
category: runtime-errors
module: history-io
problem_type: runtime_error
component: service_layer
symptoms:
  - "`changeset check` exits 1 with `EvidenceCommandFailed` naming `git merge-tree --write-tree --no-messages <first> <second>` and `exited 128: fatal: refusing to merge unrelated histories`"
  - "The `change intent` job fails on the pull request that vendors a repository for the first time with `git subtree add --squash`, while later subtree pulls pass"
root_cause: unhandled_edge_case
resolution_type: code_fix
severity: high
tags: [git, merge-tree, merge-base, subtree, unrelated-histories, changeset-check, history-io]
related_components:
  - packages/process-adapter
---

# A first squashed subtree add crashed the changeset check at merge-tree

## Problem

`changeset check` reads every commit between the merge base and `HEAD`. For a
two-parent merge it computed the merge's own edits, its residue, by running
`git merge-tree --write-tree --no-messages <first> <second>` and diffing the
resulting tree against the merge commit.

A first-time `git subtree add --squash` produces a merge whose second parent is
a parentless squash commit, so the two parents share no ancestor and git refuses
to merge them at all. `merge-tree` exited 128 with `fatal: refusing to merge
unrelated histories`, the adapter failed the whole check with
`EvidenceCommandFailed`, and every pull request that vendors a repository for
the first time was blocked — even when the vendored tree sits outside every
workspace member, where the correct verdict is a pass.

Later `git subtree pull --squash` merges do not hit this: their second parent
descends from the earlier squash commit, which the first parent already
contains, so the histories are related.

## Symptoms

- The `change intent` job fails with an annotation naming the `merge-tree`
  command, exit status 128 and git's `refusing to merge unrelated histories`,
  and no verdict about the pull request.
- Pull requests that only add or update vendored files under a prefix outside
  the workspace fail the same way; pull requests whose merge parents are
  related keep passing.

## What Didn't Work

- **`git merge-tree --allow-unrelated-histories`.** The flag makes git merge
  the two trees, but the squash commit's tree holds the vendored repository's
  files at its root rather than under the prefix the subtree merge placed them.
  The merged tree would carry the vendored files at the workspace root, and the
  residue would name root paths instead of the import — a wrong set of paths,
  not a smaller one.
- **Matching `merge-tree`'s stderr for `refusing to merge unrelated
  histories`.** It would recover from this exact message and from no other
  failure, and it would leave every other 128 on the same crash path. The
  question "do these parents share an ancestor?" has a direct answer, exit
  status 1 from `git merge-base`.

## Solution

The two-parent branch of `commitOf` in
`packages/process-adapter/src/history-io.ts` asks `git merge-base` whether the
parents are related before it reaches for `merge-tree`:

```ts
const shareAncestor = (root, first, second) =>
  Effect.gen(function*() {
    const args = ['merge-base', first, second]
    const out = yield* gitOutcome(root, args)
    if (out.code === 0) return true
    if (out.code === NO_COMMON_ANCESTOR) return false
    return yield* Effect.fail(failed(args, out.code, out.stderr))
  })
```

```ts
if (parents.length === 2) {
  const related = yield * shareAncestor(root, first, second)
  if (related) {
    return { sha: commit, parents, changes: [], residue: yield * mergeResidue(root, commit, first, second) }
  }
  return { sha: commit, parents, changes: [], residue: yield * namesBetween(root, first, commit) }
}
```

A related merge keeps the `merge-tree` path unchanged. An unrelated merge takes
its residue from `namesBetween`, the diff from its first parent to the merge
commit — the same rule the adapter already applies to octopus merges. Any other
`merge-base` exit fails the check with the command, its exit status and its
stderr.

## Why This Works

`git merge-base` exits 0 when the commits share an ancestor and 1 when they do
not; the exit status answers the relatedness question exactly, so no second
test of "is the second parent a root" is needed and no stderr is parsed. Any
other non-zero exit (a missing object, a broken repository) is a real failure
and keeps the shape the check's other git calls use.

The fallback cannot weaken the check. Residue paths only ever move a path from
release-owned to feature-owned (`changedPathsOf` puts every residue path in the
feature-touched set and clears `released` when a path is feature-touched), and
feature-owned paths are the ones that need intents. Diffing against the first
parent lists every path the unrelated merge introduced, so it can only make
more paths feature-owned than a narrower residue would. The net diff from the
merge base to `HEAD` already lists the imported paths, so a vendored tree under
a published package still fails without an intent naming it, and a vendored
tree under an unowned prefix still passes.

Diffing every two-parent merge against its first parent was rejected for the
related case: on a related merge that diff counts the target branch's own
changes and hides an evil-merge resolution, which `merge-tree` exists to
isolate.

## Prevention

- The relatedness answer is a named constant (`NO_COMMON_ANCESTOR`) at the one
  place that reads it, so a future change to the probe is visible next to the
  reason it exists.
- A failure to decide relatedness still names the command, its exit status and
  its stderr, so a repository state that breaks the probe reports itself
  instead of being read as "unrelated".
- No unit test was added: the adapter's real-git tests spawn `git` on the host,
  which this repository's testing rules admit only on request. The proof is the
  re-run of the failing `change intent` job against a build of this change; a
  related merge keeps its `merge-tree` residue and a first squashed subtree add
  now takes its first-parent diff.

## Related Issues

- `docs/change-intents.md` — "How `changeset check` reads a pull request",
  which now states how a merge of unrelated histories is read.
- `docs/plans/2026-11-22-1642-fix-gate-rederives-release-commits-plan.md` —
  the change that made a merge commit's own edits count as feature changes.
