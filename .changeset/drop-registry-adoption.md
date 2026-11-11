---
"@systemfsoftware/release-language": major
"@systemfsoftware/github-release-engine": major
"@systemfsoftware/changeset-engine": major
"@systemfsoftware/process-adapter": major
"@systemfsoftware/git-adapter": major
"@systemfsoftware/github-release-management": minor
"@systemfsoftware/changeset-management": minor
"@systemfsoftware/changesets-adapter": none
"@systemfsoftware/cli-adapter": none
"@systemfsoftware/git-hooks-engine": none
"@systemfsoftware/github-adapter": none
"@systemfsoftware/version-engine": none
"@systemfsoftware/workspace-adapter": none
---

The release no longer fetches versions from an npm registry or compares packed bytes. Packages ship through the Nix registry, which is content-addressed, so `release plan` and `release tag` decide only from changesets and tags: a version whose tag exists is skipped, never republished. A catalog bump that rewrites a packed `package.json` no longer blocks a release.

Removed: `release adopt`, `--tarballs` on `release plan` and `release tag`, the release ledger (`release-ledger.json`) and its append-only check in `changeset check`, and the `tag-integrity-mismatch`, `integrity-*`, `tarball-*`, `ledger-*`, `version-burned`, `version-intent-malformed`, `version-unknown-package` and `tag-annotation-*` refusals. `release tag` still writes annotated tags, but the message is the tag name and nothing reads it back. The packages `@systemfsoftware/adoption-adapter` and `@systemfsoftware/tarball-adapter` are deleted.

Breaking for engine callers: `planCell` and `tagCell` no longer require `TarballPort` or `LedgerPort`, `PlanRequest` and `TagRequest` have no `tarballs`, and the exported adoption and integrity symbols, `RegistryPort`, `LedgerPort`, `TarballPort` and `GitPort.tagAnnotation` are gone. `ChangeEvidenceLive` requires an `HttpClient` instead of `RegistryPort`.

Breaking for workflow callers: drop `--tarballs` and `release adopt` from any script. `release.yml` no longer builds `.#workspace-tarballs`, so a caller needs no such flake output for the release.
