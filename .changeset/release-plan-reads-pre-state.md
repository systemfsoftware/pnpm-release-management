---
"@systemfsoftware/changesets-adapter": patch
---

The release plan honors changesets pre-release mode. With `.changeset/pre.json` in `pre` mode, as written by `changeset pre enter <tag>`, `version-management bump` versions packages as `<version>-<tag>.<n>` instead of dropping them out of pre-release.
