---
"@systemfsoftware/release-language": major
"@systemfsoftware/github-release-engine": major
"@systemfsoftware/git-adapter": minor
"@systemfsoftware/git-hooks-engine": none
"@systemfsoftware/process-adapter": none
---

`github-release-management pr` now opens the release PR from the tree `version-management bump` left, the order the reusable release workflow runs them. Uncommitted changes open or refresh the release PR, and an unchanged tree closes it. Before, `pr` counted change intents after bump had consumed them, reported "nothing to release" and exited 0, so no release PR ever opened. `pr` no longer runs a bump of its own. An intent still on disk means bump has not run, so `pr` refuses with `PullRequestUnversioned` and exits 1.

Breaking for adapter authors: `GitPort` requires `uncommittedChanges`, `PullRequestRefusal` adds `PullRequestUnversioned` and `PullRequestTreeUnreadable`, and `PullRequestCommand` requires `changes`.
