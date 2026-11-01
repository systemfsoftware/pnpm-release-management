---
"@systemfsoftware/release-language": major
"@systemfsoftware/process-adapter": minor
---

`changeset-management check` with `"gate": { "strategy": "paths" }` now refuses in a repository whose root keeps a Turbo config at both the comparison base and the head, printing a `paths gate refused:` line that names the config and the fix: `"gate": { "strategy": "turbo" }`. A pull request that adds or removes the Turbo config is still decided by `paths`.

Breaking for adapter authors: `EvidenceRefusal` gains `PathsGateUnderTurbo { turboConfig }`, so exhaustive matches over it need a new case.
