---
"@systemfsoftware/release-language": major
"@systemfsoftware/version-engine": major
"@systemfsoftware/workspace-adapter": minor
"@systemfsoftware/github-release-engine": patch
---

`bump` now writes each moved member's changelog where `versioning.changelog.storage` says it lives. Under `repository` the member's own changelog gains a `## <version>` section above its earlier sections, below any title or preamble, in the file's line endings. The file is created when absent, a changelog that already has the version is left as it is, and nothing is parked, so the release phase finds the notes it reads. Under `registry` or unset, bump parks one file per moved member under `changelogDir`, byte for byte as before.

Breaking for adapter authors: `MemberChangelogEntry` carries `storage` and `path` instead of `changelogDir`, and `BumpCommand` requires `changelogStorage`. `memberChangelogPathOf`, `withVersionSection` and `releaseNotesOf` are now exported from `@systemfsoftware/release-language`.
