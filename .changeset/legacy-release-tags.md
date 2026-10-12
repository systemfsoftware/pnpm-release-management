---
"@systemfsoftware/release-language": minor
"@systemfsoftware/github-release-engine": major
"@systemfsoftware/github-release-management": minor
---

The release config accepts `legacyTags: { tag, through }` for releases cut before adoption under another tag scheme, such as a bare `v{version}`. A version at or below `through` whose legacy tag points at a commit declaring that exact version counts as released, so `release plan` and `release tag` no longer owe a second `<name>@v<version>` tag for it, and `release plan` prints `legacy release <tag> (<name>@<version>), identity not recorded` for each such version. A legacy tag whose commit declares a different version, or no such package, is refused with `legacy-tag-unverified`.

Breaking for engine callers: the plan, tag and GitHub release cells can fail with a new `LegacyTagUnverified` refusal, so exhaustive matches over their failures need that case, and `PlanReport` gains a required `legacy` list.
