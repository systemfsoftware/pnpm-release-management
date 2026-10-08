---
"@systemfsoftware/release-language": major
"@systemfsoftware/git-adapter": minor
---

`github-release-management pr` now commits the release as `github-actions[bot]`, so it works on a runner with no git identity configured. Before, the commit failed there and `pr` printed `cannot read body file: git:commit`.

A failed `git` command in `pr` now reports the command and the error git printed, instead of a body-file or pull-request-head error.

Breaking for adapter authors: `PullRequestRefusal` gains `PullRequestGitFailed { command, stderr }`.
