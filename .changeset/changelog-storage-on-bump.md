---
"@systemfsoftware/release-language": minor
"@systemfsoftware/version-engine": minor
"@systemfsoftware/workspace-adapter": minor
"@systemfsoftware/github-release-engine": patch
---

`bump` now writes each moved member's changelog where `versioning.changelog.storage` says it lives. Under `repository` the member's own changelog gains a `## <version>` section, newest first under its title, and is created when absent; nothing is parked, so the release phase finds the notes it reads. Under `registry` or unset, bump parks one file per moved member under `changelogDir`, byte for byte as before.

Breaking for adapter authors: `MemberChangelogEntry` carries `storage` and `path` instead of `changelogDir`. `memberChangelogPathOf`, `withVersionSection` and `releaseNotesOf` are now exported from `@systemfsoftware/release-language`.
