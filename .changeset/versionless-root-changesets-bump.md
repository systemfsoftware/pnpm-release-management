---
"@systemfsoftware/version-engine": major
---

`version-management bump` versions a `changesets` workspace whose private root `package.json` has no `version`. It no longer reads the root manifest under `changesets`, so it stops refusing with `VersionIntentMalformed: path=package.json`.
