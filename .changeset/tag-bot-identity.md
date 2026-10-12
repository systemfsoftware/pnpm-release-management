---
"@systemfsoftware/git-adapter": minor
"@systemfsoftware/github-release-engine": major
"@systemfsoftware/release-language": minor
---

`github-release-management tag` now writes each annotated release tag as `github-actions[bot]`, so it works on a runner with no git identity configured. Before, `git tag -a` failed there with "Committer identity unknown" and `tag` printed `cannot read captured file: git:write-tag`.

`tag` now pushes only the captured tags the remote doesn't have yet. A captured tag already on the remote at the release commit is left alone, so re-running `tag` after a partial push finishes the set. A captured tag already on the remote at another commit refuses the run with `tag-at-other-commit`, naming the tag and both commits, and nothing is pushed.

Breaking for adapter authors: `tagCell` can fail with `TagAtOtherCommit { tag, expected, found }`.
