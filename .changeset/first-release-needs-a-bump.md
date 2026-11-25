---
"@systemfsoftware/github-release-engine": patch
---

The release plan no longer releases an un-bumped tree. The cycle excludes a publishable member whose manifest version is still the uninitialized `0.0.0` — a first releasable cycle is the version the bump writes — and the phase resolves to `release` only when the cycle is owed and no intents are pending; while intents are pending the phase stays `version` so the run reconciles the release PR instead of tagging and publishing the tree that has not been bumped.
