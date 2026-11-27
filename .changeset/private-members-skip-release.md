---
"@systemfsoftware/release-language": patch
"@systemfsoftware/changesets-adapter": patch
---

A private workspace member that no change intent names stays out of the release plan and is never versioned or tagged. A change intent that names a private member without a `version` is refused as `VersionPrivatePackage`, and a publishable member without a version is refused as `ManifestInvalid` before any file is written. Plan and apply share the workspace member's manifest validation, so a malformed version fails identically on both paths.
