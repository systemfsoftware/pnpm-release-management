---
"@systemfsoftware/release-language": major
"@systemfsoftware/github-release-engine": major
"@systemfsoftware/git-adapter": minor
"@systemfsoftware/git-hooks-engine": none
"@systemfsoftware/process-adapter": none
---

`github-release-management pr` now opens the release PR from the tree `version-management bump` left. Changes to tracked files open or refresh it, and an unchanged tree closes it. Before, `pr` counted intents bump had already consumed, reported "nothing to release" and exited 0. `pr` no longer bumps by itself, and refuses with `PullRequestUnversioned` while an intent is still on disk.

The release commit holds only tracked changes and the changelogs bump created, so an untracked artifact in the checkout no longer lands in the release PR.

Breaking for adapter authors: `GitPort` gains `trackedChanges`, and `commitAll` becomes `commitRelease(message, created)`. `PullRequestRefusal` adds `PullRequestUnversioned` and `PullRequestTreeUnreadable`. `PullRequestCommand` requires `changes` and `created`; `PullRequestRequest` requires `changelogDir`.
