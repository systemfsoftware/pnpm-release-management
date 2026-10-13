---
"@systemfsoftware/github-release-engine": minor
"@systemfsoftware/github-release-management": minor
"@systemfsoftware/process-adapter": minor
---

A released package that a pull request changes under a `none` intent is now refused before merge, not by a red Release run on `main`. `github-release-management digests <base>` lists the released packages the change evidence names and the pending intents do not release. With `--tarballs <dir>` it compares each tarball with its recorded integrity by `plan`'s rules and refuses a mismatch with `tag digests refused: <package>@v<version> changed without a release`, naming both integrities, the first differing file and the fix. The reusable changeset check builds `.#workspace-tarballs` only when that list is non-empty.

New exports: `unreleasedTarballsCell` from `github-release-engine`; `evidenceRefusalLines` from `process-adapter`.
