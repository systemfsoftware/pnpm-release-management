---
"@systemfsoftware/changesets-adapter": patch
"@systemfsoftware/version-engine": patch
"@systemfsoftware/github-release-engine": none
---

`version-management bump` rewrites a sibling's version only where the range uses the `workspace:` protocol. A plain range such as `^22.0.0` resolves from the registry and names a published release. The release PR used to rewrite it to the version not yet published, so its `pnpm install --frozen-lockfile` failed.
