---
"@systemfsoftware/release-language": major
"@systemfsoftware/git-adapter": minor
"@systemfsoftware/process-adapter": patch
---

A failed `git` command while tagging now reports the command and the error git printed, instead of `cannot read captured file: git:push-tags`.

Breaking for adapter authors: `TagRefusal` gains `TagGitFailed { command, stderr }`, so exhaustive matches over it need a new case.
