---
"@systemfsoftware/release-language": patch
"@systemfsoftware/changesets-adapter": patch
---

Private workspace members are excluded from the release plan and are never versioned or tagged. A changeset intent that names a private member is refused as `VersionPrivatePackage`, and a publishable member without a version is refused as `ManifestInvalid` before any file is written. Plan and apply share the workspace member's manifest validation, so a malformed version fails identically on both paths.
