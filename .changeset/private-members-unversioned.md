---
"@systemfsoftware/changesets-adapter": patch
---

`version-management bump` no longer versions a `private: true` workspace member. Before, a member that is never published got a version bump and a CHANGELOG entry whenever a package it depends on was released.
