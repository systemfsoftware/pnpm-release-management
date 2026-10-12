---
"@systemfsoftware/changeset-engine": patch
"@systemfsoftware/process-adapter": patch
"@systemfsoftware/release-language": minor
"@systemfsoftware/cli-adapter": none
"@systemfsoftware/git-adapter": none
"@systemfsoftware/git-hooks-engine": none
"@systemfsoftware/github-adapter": none
"@systemfsoftware/github-release-engine": none
"@systemfsoftware/version-engine": none
"@systemfsoftware/workspace-adapter": none
---

`changeset check` now lists a package deleted on the head as deleted instead of failing with "cannot read". A deleted package needs no intent. `ChangeEvidence` gains a `deleted` list of package names.
