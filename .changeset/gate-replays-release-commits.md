---
"@systemfsoftware/release-language": minor
"@systemfsoftware/changeset-engine": minor
"@systemfsoftware/process-adapter": minor
"@systemfsoftware/version-engine": minor
"@systemfsoftware/git-adapter": minor
"@systemfsoftware/workspace-adapter": patch
"@systemfsoftware/changesets-adapter": patch
"@systemfsoftware/github-release-engine": none
"@systemfsoftware/git-hooks-engine": none
"@systemfsoftware/cli-adapter": none
"@systemfsoftware/github-adapter": none
---

`changeset-management check` no longer trusts the branch name. It replays each commit that only deletes pending intents through `version bump` from that commit's parent, and passes it as a release only when the trees match exactly, so the release PR passes on a merge-queue draft and a manifest edit or extra file in a release commit is refused. Intent edits must keep each package's highest owed bump, a release cut from a base that has since changed a release surface is refused as stale, and under the turbo gate a package moved only by accounted dependencies needs no intent of its own. `ChangeEvidencePort` now reports git and turbo facts, a new `ReleaseReplayPort` names the replay, `version-engine` exports `bumpInputOf`, and `GitPort` drops `currentBranch` and `changedPaths`. A shallow clone is refused.
