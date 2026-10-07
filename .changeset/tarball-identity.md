---
"@systemfsoftware/tarball-adapter": minor
"@systemfsoftware/github-release-engine": minor
"@systemfsoftware/release-language": minor
"@systemfsoftware/git-adapter": minor
"@systemfsoftware/changesets-adapter": patch
"@systemfsoftware/changeset-engine": none
"@systemfsoftware/cli-adapter": none
"@systemfsoftware/git-hooks-engine": none
"@systemfsoftware/github-adapter": none
"@systemfsoftware/process-adapter": none
"@systemfsoftware/version-engine": none
"@systemfsoftware/workspace-adapter": none
---

`release tag` records each released tarball's integrity in an annotated `<name>@v<version>` tag, and `release plan` refuses to plan when a tarball at an already released version no longer matches that record, naming the package, both hashes and the first differing file. `release plan` and `release tag` now require `--tarballs <dir>`.
