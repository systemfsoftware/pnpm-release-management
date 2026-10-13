---
"@systemfsoftware/workspace-adapter": patch
---

`version-management bump` now creates `changelogDir` before parking a moved member's changelog there. A fresh checkout has no such directory, so under `registry` changelog storage (the default) bump used to refuse with `ChangelogUnwritable ... reason=NotFound` as soon as an intent moved a member. A `changelogDir` path that holds a regular file is still refused with `ChangelogUnwritable`.
